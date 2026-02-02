import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import PDFUploader from '@/components/PDFUploader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Check, Clock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface Statement {
  id: string;
  file_name: string;
  uploaded_at: string;
  processed: boolean;
  processing_error: string | null;
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
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setStatements(data || []);
    } catch (error) {
      console.error('Error fetching statements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = async (statementId: string) => {
    toast({
      title: 'Extracto subido',
      description: 'El archivo se ha guardado. Ahora puedes agregar transacciones manualmente.',
    });

    // Mark as processed (in MVP, we add sample data for demo)
    try {
      const sampleTransactions = [
        { date: '2024-01-15', description: 'TRANSFERENCIA RECIBIDA CLIENTE ABC', amount: 5500000, category: 'ventas' },
        { date: '2024-01-14', description: 'PAGO PROVEEDOR XYZ SAS', amount: -2300000, category: 'proveedores' },
        { date: '2024-01-12', description: 'NOMINA ENERO 2024', amount: -4500000, category: 'nomina' },
        { date: '2024-01-10', description: 'PAGO SERVICIOS PUBLICOS', amount: -850000, category: 'servicios' },
        { date: '2024-01-08', description: 'TRANSFERENCIA RECIBIDA VENTA #1234', amount: 3200000, category: 'ventas' },
        { date: '2024-01-05', description: 'PAGO ARRIENDO LOCAL COMERCIAL', amount: -2800000, category: 'gastos_operativos' },
        { date: '2024-01-03', description: 'PAGO RETEFUENTE', amount: -145000, category: 'impuestos', affects_dian: true },
        { date: '2024-01-02', description: 'TRANSFERENCIA RECIBIDA FACTURA #567', amount: 8900000, category: 'ventas', has_vat: true },
      ];

      for (const tx of sampleTransactions) {
        await supabase.from('transactions').insert({
          user_id: user!.id,
          statement_id: statementId,
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          debit: tx.amount < 0 ? Math.abs(tx.amount) : null,
          credit: tx.amount > 0 ? tx.amount : null,
          category: tx.category,
          has_vat: tx.has_vat || false,
          affects_dian: tx.affects_dian || false,
        });
      }

      await supabase
        .from('bank_statements')
        .update({ processed: true })
        .eq('id', statementId);

      await fetchStatements();

      toast({
        title: '¡Transacciones cargadas!',
        description: 'Ve a Transacciones para revisarlas y editarlas.',
      });

      // Navigate to transactions after a short delay
      setTimeout(() => navigate('/transactions'), 1500);
    } catch (error) {
      console.error('Processing error:', error);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <section className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Subir Extracto Bancario
          </h1>
          <p className="text-muted-foreground mb-6">
            Sube tu extracto bancario de Bancolombia en formato PDF.
          </p>
          <PDFUploader onUploadComplete={handleUploadComplete} />
        </section>

        {statements.length > 0 && (
          <section className="animate-slide-up">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Extractos subidos</CardTitle>
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
                      <div>
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
