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
import { logEvent } from '@/lib/analytics';
import PostUploadDuplicatesModal, { type PostUploadDuplicate } from '@/components/statements/PostUploadDuplicatesModal';

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

  // Post-upload dedup
  const [postUploadDuplicates, setPostUploadDuplicates] = useState<PostUploadDuplicate[]>([]);
  const [postUploadDupOpen, setPostUploadDupOpen] = useState(false);
  const [postUploadTotalNew, setPostUploadTotalNew] = useState(0);
  const [postUploadDeleting, setPostUploadDeleting] = useState(false);

  /** Detector post-hoc: chequea si las tx recién insertadas tienen duplicados
   *  en otros statements del mismo user. Si sí, muestra modal. */
  const checkPostUploadDuplicates = async (statementId: string) => {
    try {
      const { data: newTxs, error: txErr } = await supabase
        .from('transactions')
        .select('id, date, amount, description')
        .eq('statement_id', statementId)
        .is('deleted_at', null);
      if (txErr || !newTxs || newTxs.length === 0) return;

      const candidates = newTxs.map((t) => ({
        date: t.date,
        amount: t.amount,
        description: t.description,
      }));
      const { data: matches, error: rpcErr } = await (supabase as any).rpc(
        'find_duplicate_transactions',
        { p_user_id: user?.id, p_candidates: candidates }
      );
      if (rpcErr) {
        console.warn('Post-upload dedup check failed:', rpcErr);
        return;
      }

      // Filtrar: solo matches con OTROS statements (no consigo mismo).
      const crossStatementMatches = ((matches ?? []) as Array<{
        candidate_index: number;
        matched_tx_id: string;
        matched_date: string;
        matched_amount: number;
        matched_description: string;
        matched_statement_id: string | null;
      }>).filter((m) => m.matched_statement_id !== statementId);

      if (crossStatementMatches.length === 0) return;

      // Mapear a shape de modal: new_tx_id = id de la nueva tx en este statement.
      const dups: PostUploadDuplicate[] = crossStatementMatches.map((m) => ({
        new_tx_id: newTxs[m.candidate_index].id,
        matched_tx_id: m.matched_tx_id,
        matched_date: m.matched_date,
        matched_amount: m.matched_amount,
        matched_description: m.matched_description,
      }));

      setPostUploadDuplicates(dups);
      setPostUploadTotalNew(newTxs.length);
      setPostUploadDupOpen(true);
    } catch (err) {
      console.warn('Post-upload dedup unexpected error:', err);
    }
  };

  const handleDeletePostUploadDuplicates = async () => {
    if (postUploadDuplicates.length === 0) return;
    setPostUploadDeleting(true);
    try {
      const ids = postUploadDuplicates.map((d) => d.new_tx_id);
      const { error: delErr } = await supabase
        .from('transactions')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids);
      if (delErr) throw delErr;
      toast({
        title: 'Duplicadas borradas',
        description: `${ids.length} transacciones nuevas marcadas como eliminadas. Las originales se preservaron.`,
      });
      setPostUploadDupOpen(false);
      setPostUploadDuplicates([]);
      await fetchStatements();
    } catch (err: any) {
      toast({
        title: 'Error al borrar',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setPostUploadDeleting(false);
    }
  };

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

        // El edge function ya devuelve mensajes en español, accionables y
        // específicos. Lo único que interceptamos en el cliente es el caso
        // del límite de plan (403 + limit_exceeded) que requiere navegación.
        if (response.status === 403 && errorData.limit_exceeded) {
          toast({
            title: 'Límite alcanzado',
            description: errorData.message || 'Actualiza tu plan para continuar subiendo extractos.',
            variant: 'destructive',
          });
          navigate('/pricing');
          return;
        }

        // Para 429/402/503/etc usamos el mensaje del edge function
        // (más informativo que un genérico).
        throw new Error(errorData.error || 'No pudimos procesar el PDF. Probá de nuevo en unos segundos.');
      }

      const result = await response.json();
      await fetchStatements();

      // Telemetría: extracto procesado OK
      logEvent('extracto_uploaded', {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: {
          statement_id: statementId,
          transactions_count: result.transactions_count ?? 0,
          source: 'pdf',
        },
      });

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

      // Detector de duplicados cross-statement (post-hoc). Si encuentra
      // matches con otros extractos previos, muestra modal antes del config.
      await checkPostUploadDuplicates(statementId);

      // Open mandatory config modal after successful processing
      setPendingStatementId(statementId);
      setEditingStatement(null);
      setModalOpen(true);
    } catch (error: any) {
      console.error('Processing error:', error);
      await fetchStatements();

      // Telemetría: error en flujo crítico de extractos
      logEvent('flow_error', {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: {
          flow: 'parse-bancolombia-pdf',
          error: String(error?.message ?? error).slice(0, 200),
          statement_id: statementId,
        },
      });

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
            Sube tu extracto bancario
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
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, fontFamily: 'inherit' }}>
                ¿Con qué frecuencia conciliás tus cuentas?
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, fontFamily: 'inherit' }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>Semanal</strong> → subí el <strong>CSV/ZIP</strong> de movimientos desde el portal (rápido, sin OCR). Al cierre del mes, validás con el PDF oficial.
                </div>
                <div>
                  <strong>Mensual</strong> → subí el <strong>PDF</strong> oficial del banco, una sola vez al mes.
                </div>
              </div>
            </div>
          </div>

          {/* Split: PDF (cierre mensual) | CSV/ZIP (semanal).
              alignItems:stretch + flex:1 en el Card wrapper garantiza que los
              dos uploaders queden del mismo alto aunque sus contenidos internos
              difieran (el PDFUploader tiene botón, el CSV no). */}
          <style>{`
            @media (max-width: 767px) {
              .upload-split { grid-template-columns: 1fr !important; }
            }
            .upload-card-wrap { flex: 1; display: flex; flex-direction: column; min-height: 260px; }
            .upload-card-wrap > :first-child { flex: 1; display: flex; flex-direction: column; }
            .upload-card-wrap > :first-child > :first-child { flex: 1; display: flex; flex-direction: column; justify-content: center; }
          `}</style>
          <div
            className="upload-split"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 20,
              alignItems: 'stretch',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2
                style={{
                  fontFamily: 'inherit',
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#1d1d1f',
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                Cierre mensual (PDF)
              </h2>
              <div className="upload-card-wrap">
                <PDFUploader onUploadComplete={handleUploadComplete} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2
                style={{
                  fontFamily: 'inherit',
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#1d1d1f',
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                Movimientos semanales (CSV/ZIP)
              </h2>
              <div className="upload-card-wrap">
                <WeeklyCsvUploader onUploadComplete={fetchStatements} />
              </div>
            </div>
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
                        {/* Mensaje del error específico — antes solo se veía un badge "Error"
                            sin contexto, así el usuario sabía que algo falló pero no qué.
                            Ahora mostramos el detalle textual debajo del nombre. */}
                        {statement.processing_error && (
                          <p
                            style={{
                              fontFamily: 'inherit',
                              fontSize: 12,
                              color: 'rgb(185, 28, 28)',
                              margin: '4px 0 0',
                              lineHeight: 1.4,
                            }}
                          >
                            {statement.processing_error}
                          </p>
                        )}
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
          onClose={() => setModalOpen(false)}
          required={!editingStatement} // Required only after a new upload
        />
      )}

      {/* Detector duplicados cross-statement (post-hoc, solo PDF) */}
      <PostUploadDuplicatesModal
        open={postUploadDupOpen}
        duplicates={postUploadDuplicates}
        totalNew={postUploadTotalNew}
        isProcessing={postUploadDeleting}
        onKeep={() => {
          setPostUploadDupOpen(false);
          setPostUploadDuplicates([]);
        }}
        onDeleteDuplicates={handleDeletePostUploadDuplicates}
      />
    </AppLayout>
  );
}
