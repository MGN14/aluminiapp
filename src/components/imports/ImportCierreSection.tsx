import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useImportDocuments, IMPORT_DOC_LABEL, type ImportDocTipo, type ImportDocumentRow } from '@/hooks/useImportDocuments';
import { CheckCircle2, Circle, Upload, Trash2, ExternalLink, Lock, LockOpen, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  importId: string;
  cerrada: boolean;
  cerradaAt: string | null;
  estado: string;
  /** admin = dueño de la cuenta (o admin de plataforma) — único que cierra/reabre */
  esAdmin: boolean;
  /** cantidad de abonos registrados — se exige un swift por abono */
  paymentsCount: number;
}

interface ChecklistItem {
  tipo: ImportDocTipo;
  label: string;
  hint: string;
  requerido: number;
}

/**
 * Cierre de la importación con checklist documental (se habilita al pasar a
 * 'entregado'). El backend re-valida todo en cerrar_importacion(); esta UI
 * muestra el progreso y sube los archivos al bucket privado.
 */
export default function ImportCierreSection({ importId, cerrada, cerradaAt, estado, esAdmin, paymentsCount }: Props) {
  const { docs, upload, remove, view, cerrar, reabrir } = useImportDocuments(importId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingTipo, setUploadingTipo] = useState<ImportDocTipo | null>(null);

  const byTipo = (tipo: ImportDocTipo) => docs.filter(d => d.tipo === tipo);

  const items: ChecklistItem[] = [
    {
      tipo: 'swift',
      label: 'Swifts de los abonos',
      hint: paymentsCount > 0
        ? `Constancia de cada giro — ${paymentsCount} abono${paymentsCount !== 1 ? 's' : ''} registrado${paymentsCount !== 1 ? 's' : ''}`
        : 'Constancia de cada giro al proveedor',
      requerido: Math.max(paymentsCount, 1),
    },
    {
      tipo: 'dim',
      label: 'DIM — Declaración de Importación',
      hint: 'La declaración de aduana del contenedor',
      requerido: 1,
    },
    {
      tipo: 'certificado_banrep',
      label: 'Certificado BanRep (excel)',
      hint: 'Excel de legalización de pagos ante Banco de la República (basta uno como evidencia de envío a Bancolombia)',
      requerido: 1,
    },
    {
      tipo: 'costeo_excel',
      label: 'Excel de costeo',
      hint: 'El costeo final del contenedor — obligatorio para cerrar',
      requerido: 1,
    },
  ];

  const completos = items.filter(i => byTipo(i.tipo).length >= i.requerido).length;
  const listo = completos === items.length;

  const pickFile = (tipo: ImportDocTipo) => {
    setUploadingTipo(tipo);
    fileRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !uploadingTipo) return;
    await upload.mutateAsync({ tipo: uploadingTipo, file });
    setUploadingTipo(null);
  };

  const handleCerrar = async () => {
    if (!window.confirm(
      'Vas a CERRAR esta importación. Queda bloqueada para colaboradores (solo el admin puede modificarla o reabrirla). ¿Continuar?'
    )) return;
    await cerrar.mutateAsync();
  };

  const handleReabrir = async () => {
    if (!window.confirm('¿Reabrir la importación? Vuelve a ser editable.')) return;
    await reabrir.mutateAsync();
  };

  // ── Cerrada: banner + reabrir (solo admin) ────────────────────────────────
  if (cerrada) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-success" />
            <span className="text-sm font-semibold text-success">Importación cerrada</span>
            {cerradaAt && (
              <span className="text-xs text-muted-foreground">
                el {new Date(cerradaAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          {esAdmin && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleReabrir} disabled={reabrir.isPending}>
              <LockOpen className="h-3.5 w-3.5" /> Reabrir (admin)
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Checklist documental completo. Solo el administrador puede modificarla o reabrirla.
        </p>
        {docs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {docs.map(d => <DocChip key={d.id} doc={d} onView={view} />)}
          </div>
        )}
      </div>
    );
  }

  // Solo se muestra cuando la importación llegó a 'entregado'.
  if (estado !== 'entregado') return null;

  // ── Checklist de cierre ───────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.03] px-4 py-3 space-y-3">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={e => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Cierre de la importación</span>
          <Badge variant="outline" className={cn('text-[10px]', listo ? 'border-success/40 text-success' : 'border-amber-400/50 text-amber-600')}>
            {completos}/{items.length} completos
          </Badge>
        </div>
        {esAdmin && (
          <Button
            type="button" size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={!listo || cerrar.isPending}
            onClick={handleCerrar}
            title={listo ? 'Cerrar la importación' : 'Subí todos los documentos del checklist para poder cerrar'}
          >
            {cerrar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            Cerrar importación
          </Button>
        )}
      </div>
      {!esAdmin && (
        <p className="text-[11px] text-amber-600">Solo el administrador puede cerrar la importación — podés subir los documentos.</p>
      )}

      <div className="space-y-2">
        {items.map(item => {
          const subidos = byTipo(item.tipo);
          const ok = subidos.length >= item.requerido;
          return (
            <div key={item.tipo} className={cn('rounded-lg border px-3 py-2', ok ? 'border-success/30 bg-success/5' : 'border-border bg-card')}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  {ok
                    ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    : <Circle className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {item.label}
                      {item.requerido > 1 && (
                        <span className={cn('ml-1.5 font-mono text-[10px]', ok ? 'text-success' : 'text-amber-600')}>
                          {subidos.length}/{item.requerido}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{item.hint}</p>
                  </div>
                </div>
                <Button
                  type="button" size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0"
                  onClick={() => pickFile(item.tipo)}
                  disabled={upload.isPending}
                >
                  {upload.isPending && uploadingTipo === item.tipo
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Upload className="h-3 w-3" />}
                  Subir
                </Button>
              </div>
              {subidos.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 pl-6">
                  {subidos.map(d => (
                    <DocChip key={d.id} doc={d} onView={view} onRemove={(doc) => remove.mutate(doc)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocChip({ doc, onView, onRemove }: {
  doc: ImportDocumentRow;
  onView: (d: ImportDocumentRow) => void;
  onRemove?: (d: ImportDocumentRow) => void;
}) {
  const name = doc.filename ?? IMPORT_DOC_LABEL[doc.tipo];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] max-w-[220px]">
      <button type="button" className="inline-flex items-center gap-1 hover:text-primary truncate" onClick={() => onView(doc)} title={`Ver ${name}`}>
        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      {onRemove && (
        <button type="button" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => onRemove(doc)} title="Eliminar documento">
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
