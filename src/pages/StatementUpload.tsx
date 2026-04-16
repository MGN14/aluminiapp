import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchWithAuthRetry } from '@/lib/authRetry';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import PDFUploader from '@/components/PDFUploader';
import DeleteStatementButton from '@/components/statements/DeleteStatementButton';
import StatementConfigModal from '@/components/statements/StatementConfigModal';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Check, Clock, AlertCircle, Info, Pencil, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useReconciliationRules } from '@/hooks/useReconciliationRules';

interface Statement {
  id: string;
  file_name: string;
  file_path: string;
  uploaded_at: string;
  processed: boolean;
  processing_error: string | null;
  transaction_count: number;
  display_name: string | null;
  bank_name: string;
  statement_month: number | null;
  statement_year: number | null;
  account_number: string | null;
}

export default function StatementUpload() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const { applyRulesToStatement, rules } = useReconciliationRules();

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingStatementId, setPendingStatementId] = useState<string | null>(null);
  const [editingStatement, setEditingStatement] = useState<Statement | null>(null);

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
      setStatements((data || []) as Statement[]);
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

      // Auto-apply Nico reconciliation rules to the freshly parsed transactions
      const activeRules = rules.filter(r => r.active && r.category_id);
      if (activeRules.length > 0) {
        try {
          const applied = await applyRulesToStatement(statementId);
          if (applied > 0) {
            toast({
              title: '¡Transacciones extraídas!',
              description: `${result.transactions_count} transacciones encontradas. Nico aplicó ${applied} regla${applied > 1 ? 's' : ''} de conciliación automáticamente. 🎉`,
            });
          } else {
            toast({
              title: '¡Transacciones extraídas!',
              description: `Se encontraron ${result.transactions_count} transacciones. Configura el extracto para continuar.`,
            });
          }
        } catch {
          toast({
            title: '¡Transacciones extraídas!',
            description: `Se encontraron ${result.transactions_count} transacciones. Configura el extracto para continuar.`,
          });
        }
      } else {
        toast({
          title: '¡Transacciones extraídas!',
          description: `Se encontraron ${result.transactions_count} transacciones. Configura el extracto para continuar.`,
        });
      }

      // Open mandatory config modal after successful processing
      setPendingStatementId(statementId);
      setEditingStatement(null);
      setModalOpen(true);
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

  const handleModalSaved = () => {
    setModalOpen(false);
    setPendingStatementId(null);
    setEditingStatement(null);
    fetchStatements();

    if (!editingStatement) {
      // After new upload, navigate to transactions
      setTimeout(() => navigate('/transactions'), 1200);
    }
  };

  const openEditModal = (stmt: Statement) => {
    setEditingStatement(stmt);
    setPendingStatementId(null);
    setModalOpen(true);
  };

  const activeStatementId = editingStatement?.id ?? pendingStatementId ?? '';

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

          {/* Nico rules indicator */}
          {rules.filter(r => r.active).length > 0 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-success bg-success/5 border border-success/20 rounded-lg px-4 py-2.5">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{rules.filter(r => r.active).length} regla{rules.filter(r => r.active).length > 1 ? 's' : ''} de Nico activa{rules.filter(r => r.active).length > 1 ? 's' : ''}</strong> — se aplicarán automáticamente al procesar el extracto
              </span>
            </div>
          )}
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
                        <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div>
                          <p className="font-medium text-sm">
                            {statement.display_name || statement.file_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(statement.uploaded_at), "dd MMM yyyy, HH:mm", { locale: es })}
                            {statement.transaction_count
                              ? ` · ${statement.transaction_count} transacciones`
                              : ''}
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Editar configuración"
                          onClick={() => openEditModal(statement)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <DeleteStatementButton
                          statementId={statement.id}
                          fileName={statement.display_name || statement.file_name}
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

      {/* Statement config modal */}
      {activeStatementId && (
        <StatementConfigModal
          open={modalOpen}
          statementId={activeStatementId}
          initialBankName={editingStatement?.bank_name}
          initialMonth={editingStatement?.statement_month}
          initialYear={editingStatement?.statement_year}
          initialAccountNumber={editingStatement?.account_number}
          onSaved={handleModalSaved}
          required={!editingStatement} // Required only after a new upload
        />
      )}
    </AppLayout>
  );
}
