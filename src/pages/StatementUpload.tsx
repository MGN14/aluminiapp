import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchWithAuthRetry } from '@/lib/authRetry';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import PDFUploader from '@/components/PDFUploader';
import DeleteStatementButton from '@/components/statements/DeleteStatementButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Check, Clock, AlertCircle, Info } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Statement {
  id: string;
  file_name: string;
  file_path: string;
  uploaded_at: string;
  processed: boolean;
  processing_error: string | null;
  transaction_count: number;
}

export default function StatementUpload() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatements();
  }, []);

  const fetchStatements = async () => {
    try {
      const { data, error } = await supabase
        .from('bank_statements')
        .select('*')
        .is('deleted_at', null)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setStatements(data || []);
    } catch (error) {
      console.error('Error fetching statements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = async (statementId: string, filePath: string) => {
    toast({
      title: 'Extracto subido',
      description: 'Procesando PDF con inteligencia artificial...',
    });

    try {
      // Call edge function with authenticated user token
      const response = await fetchWithAuthRetry(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-bancolombia-pdf`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_path: filePath,
            statement_id: statementId,
          }),
        },
        'parse-bancolombia-pdf'
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 429) {
          throw new Error('Límite de solicitudes excedido. Intenta de nuevo en unos minutos.');
        }
        if (response.status === 402) {
          throw new Error('Se requiere agregar créditos para continuar procesando.');
        }
        if (response.status === 403 && errorData.limit_exceeded) {
          toast({
            title: 'Límite alcanzado',
            description: errorData.message || 'Actualiza tu plan para continuar subiendo extractos.',
            variant: 'destructive',
          });
          navigate('/pricing');
          return;
        }
        
        throw new Error(errorData.error || 'Error al procesar el PDF');
      }

      const result = await response.json();

      await fetchStatements();

      toast({
        title: '¡Transacciones extraídas!',
        description: `Se encontraron ${result.transactions_count} transacciones. Ve a Transacciones para revisarlas.`,
      });

      setTimeout(() => navigate('/transactions'), 1500);
    } catch (error: any) {
      console.error('Processing error:', error);
      
      await fetchStatements();
      
      toast({
        title: 'Error al procesar',
        description: error.message || 'Hubo un error al procesar el extracto.',
        variant: 'destructive',
      });
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <section className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Sube tu extracto bancario (PDF)
          </h1>
          <p className="text-muted-foreground mb-6">
            Funciona con múltiples bancos. Si tu PDF no se procesa correctamente, lo ajustamos.
          </p>

          <Alert className="mb-6">
            <Info className="h-4 w-4" />
            <AlertTitle>Formato esperado del PDF</AlertTitle>
            <AlertDescription>
              Soportamos distintos formatos de extractos bancarios. El PDF debe contener la tabla de movimientos con: fecha, descripción, valor y saldo.
              Algunos formatos pueden requerir ajuste de plantilla.
            </AlertDescription>
          </Alert>

          <PDFUploader onUploadComplete={handleUploadComplete} />
        </section>

        {statements.length > 0 && (
          <section className="animate-slide-up">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Extractos subidos</CardTitle>
                <CardDescription>
                  Los extractos procesados tienen sus transacciones disponibles para edición
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {statements.map((statement) => (
                    <div
                      key={statement.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{statement.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(statement.uploaded_at), "dd MMM yyyy, HH:mm", { locale: es })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {statement.processing_error ? (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Error
                          </Badge>
                        ) : statement.processed ? (
                          <Badge variant="secondary" className="flex items-center gap-1 bg-success/10 text-success">
                            <Check className="h-3 w-3" />
                            Procesado
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Pendiente
                          </Badge>
                        )}
                        <DeleteStatementButton
                          statementId={statement.id}
                          fileName={statement.file_name}
                          filePath={statement.file_path}
                          transactionCount={statement.transaction_count}
                          onDeleted={fetchStatements}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
