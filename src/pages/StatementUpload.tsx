import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchWithAuthRetry } from '@/lib/authRetry';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import PDFUploader from '@/components/PDFUploader';
import WeeklyCsvUploader from '@/components/statements/WeeklyCsvUploader';
import DeleteStatementButton from '@/components/statements/DeleteStatementButton';
import StatementConfigModal from '@/components/statements/StatementConfigModal';
import { Button } from '@/components/ui/button';
import { FileText, Check, Clock, AlertCircle, Info, Pencil, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
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

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif";

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
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          maxWidth: 896,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
          fontFamily: FONT_STACK,
        }}
      >
        <section style={{ fontFamily: 'inherit' }}>
          <h1
            style={{
              fontFamily: 'inherit',
              fontSize: 24,
              fontWeight: 700,
              color: '#1d1d1f',
              marginBottom: 8,
              letterSpacing: '-0.01em',
            }}
          >
            Sube tu extracto bancario (PDF)
          </h1>
          <p
            style={{
              fontFamily: 'inherit',
              color: 'rgba(0,0,0,0.55)',
              marginBottom: 24,
              fontSize: 15,
            }}
          >
            Funciona con múltiples bancos. Si tu PDF no se procesa correctamente, lo ajustamos.
          </p>

          <div
            style={{
              background: 'oklch(0.52 0.16 240 / 0.06)',
              border: '1px solid oklch(0.52 0.16 240 / 0.18)',
              borderRadius: 12,
              padding: '14px 16px',
              marginBottom: 24,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              fontFamily: 'inherit',
            }}
          >
            <Info className="h-4 w-4" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontFamily: 'inherit' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, fontFamily: 'inherit' }}>
                Formato esperado del PDF
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit' }}>
                Soportamos distintos formatos de extractos bancarios. El PDF debe contener la tabla de movimientos con: fecha, descripción, valor y saldo.
                Algunos formatos pueden requerir ajuste de plantilla.
              </div>
            </div>
          </div>

          <PDFUploader onUploadComplete={handleUploadComplete} />

          {/* Upload semanal por CSV/ZIP (Fase 2 conciliación semanal).
              Vive en paralelo al PDF uploader para no romper el flujo existente. */}
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                fontFamily: 'inherit',
                fontSize: 13,
                color: 'rgba(0,0,0,0.55)',
                marginBottom: 10,
              }}
            >
              <strong style={{ color: '#1d1d1f' }}>¿Tenés los movimientos en CSV o ZIP?</strong>{' '}
              Subilos acá para cargas semanales sin OCR (es más rápido y preciso).
            </div>
            <WeeklyCsvUploader onUploadComplete={fetchStatements} />
          </div>

          {/* Nico rules indicator */}
          {rules.filter(r => r.active).length > 0 && (
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                background: 'oklch(0.43 0.14 155 / 0.05)',
                border: '1px solid oklch(0.43 0.14 155 / 0.2)',
                color: 'oklch(0.43 0.14 155)',
                borderRadius: 12,
                padding: '10px 16px',
                fontFamily: 'inherit',
              }}
            >
              <Zap className="h-3.5 w-3.5 shrink-0" />
              <span style={{ fontFamily: 'inherit' }}>
                <strong>{rules.filter(r => r.active).length} regla{rules.filter(r => r.active).length > 1 ? 's' : ''} de Nico activa{rules.filter(r => r.active).length > 1 ? 's' : ''}</strong> — se aplicarán automáticamente al procesar el extracto
              </span>
            </div>
          )}
        </section>

        {statements.length > 0 && (
          <section style={{ fontFamily: 'inherit' }}>
            <div
              style={{
                background: '#fff',
                borderRadius: 20,
                border: '1px solid rgba(0,0,0,0.07)',
                padding: '24px 24px 20px',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ marginBottom: 16, fontFamily: 'inherit' }}>
                <h2
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 18,
                    fontWeight: 600,
                    color: '#1d1d1f',
                    margin: 0,
                    letterSpacing: '-0.01em',
                  }}
                >
                  Extractos subidos
                </h2>
                <p
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 13,
                    color: 'rgba(0,0,0,0.55)',
                    margin: '4px 0 0',
                  }}
                >
                  Los extractos procesados tienen sus transacciones disponibles para edición
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {statements.map((statement) => (
                  <div
                    key={statement.id}
                    style={{
                      background: '#fff',
                      borderRadius: 14,
                      border: '1.5px solid rgba(0,0,0,0.07)',
                      padding: '16px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                      animation: 'fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both',
                      justifyContent: 'space-between',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                      <FileText
                        className="h-5 w-5 shrink-0"
                        style={{ color: 'rgba(0,0,0,0.55)' }}
                      />
                      <div style={{ minWidth: 0, fontFamily: 'inherit' }}>
                        <p
                          style={{
                            fontFamily: 'inherit',
                            fontWeight: 500,
                            fontSize: 14,
                            color: '#1d1d1f',
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {statement.display_name || statement.file_name}
                        </p>
                        <p
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 12,
                            color: 'rgba(0,0,0,0.55)',
                            margin: '2px 0 0',
                          }}
                        >
                          {format(new Date(statement.uploaded_at), "dd MMM yyyy, HH:mm", { locale: es })}
                          {statement.transaction_count
                            ? ` · ${statement.transaction_count} transacciones`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {statement.processing_error ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 500,
                            padding: '4px 10px',
                            borderRadius: 99,
                            border: '1px solid rgba(220, 38, 38, 0.25)',
                            background: 'rgba(220, 38, 38, 0.08)',
                            color: 'rgb(185, 28, 28)',
                            fontFamily: 'inherit',
                          }}
                        >
                          <AlertCircle className="h-3 w-3" />
                          Error
                        </span>
                      ) : statement.processed ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 500,
                            padding: '4px 10px',
                            borderRadius: 99,
                            border: '1px solid oklch(0.43 0.14 155 / 0.2)',
                            background: 'oklch(0.43 0.14 155 / 0.08)',
                            color: 'oklch(0.43 0.14 155)',
                            fontFamily: 'inherit',
                          }}
                        >
                          <Check className="h-3 w-3" />
                          Procesado
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 500,
                            padding: '4px 10px',
                            borderRadius: 99,
                            border: '1px solid rgba(0,0,0,0.07)',
                            background: 'rgba(0,0,0,0.04)',
                            color: 'rgba(0,0,0,0.65)',
                            fontFamily: 'inherit',
                          }}
                        >
                          <Clock className="h-3 w-3" />
                          Pendiente
                        </span>
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
            </div>
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
