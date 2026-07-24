import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useImportDocuments, IMPORT_DOC_LABEL, type ImportDocTipo, type ImportDocumentRow } from '@/hooks/useImportDocuments';
import { useImportItems, type NewImportItem } from '@/hooks/useImportItems';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { parseDelimited, parseLooseNumber } from '@/lib/delimitedParser';
import { guessMapping, isSummaryReference, hasAnyData, makeCellNumberParser, type FieldKey } from '@/lib/packingListParse';
import { CheckCircle2, Circle, Upload, Trash2, ExternalLink, Lock, LockOpen, Loader2, FileSpreadsheet } from 'lucide-react';
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

/** Resultado de leer el excel de costeo: filas listas para import_items. */
interface CosteoParse {
  rows: NewImportItem[];
  conCosto: number;
  sheetName: string | null;
}

/**
 * Lee el excel/CSV de costeo con las MISMAS heurísticas del importador de
 * packing list (guessMapping calibrado al formato de Nico) y devuelve las
 * filas mapeadas. null = no se pudo leer una tabla con Referencia.
 */
async function parseCosteoFile(file: File): Promise<CosteoParse | null> {
  const candidates: { name: string | null; rows: string[][]; strict: boolean }[] = [];
  if (isExcelFile(file)) {
    const sheets = await readXlsxFile(file);
    for (const s of sheets) candidates.push({ name: s.name, rows: s.rows, strict: true });
  } else {
    const text = await file.text();
    candidates.push({ name: null, rows: parseDelimited(text).rows, strict: false });
  }

  let best: CosteoParse | null = null;
  for (const c of candidates) {
    if (!c.rows.length) continue;
    const colCount = Math.max(...c.rows.map(r => r.length));
    const mapping: FieldKey[] = guessMapping(c.rows[0] ?? [], colCount);
    if (!mapping.includes('reference')) continue;
    const num = makeCellNumberParser(c.strict, parseLooseNumber);
    const idxOf = (f: FieldKey) => mapping.indexOf(f);
    const ref = idxOf('reference'), desc = idxOf('descripcion'), cant = idxOf('cantidad');
    const uni = idxOf('unidad'), peso = idxOf('peso_kg'), fob = idxOf('fob_total_usd');
    const col = idxOf('color'), bul = idxOf('bultos'), cue = idxOf('costo_unitario_excel');
    const rows = c.rows.slice(1)
      .map((r, i): NewImportItem => ({
        reference: (ref > -1 ? r[ref] : '')?.trim() ?? '',
        descripcion: desc > -1 ? (r[desc]?.trim() || null) : null,
        cantidad: cant > -1 ? num(r[cant]) : 0,
        unidad: uni > -1 ? (r[uni]?.trim() || 'kg') : 'kg',
        peso_kg: peso > -1 && r[peso]?.trim() ? num(r[peso]) : null,
        fob_total_usd: fob > -1 ? num(r[fob]) : 0,
        orden: i,
        notas: null,
        color: col > -1 ? (r[col]?.trim() || null) : null,
        bultos: bul > -1 && r[bul]?.trim() ? num(r[bul]) : null,
        costo_unitario_excel: cue > -1 && r[cue]?.trim() ? num(r[cue]) : null,
      }))
      .filter(it => it.reference.length > 0 && !isSummaryReference(it.reference) && hasAnyData(it));
    if (!rows.length) continue;
    const conCosto = rows.filter(r => Number(r.costo_unitario_excel ?? 0) > 0).length;
    // Mejor hoja = más filas válidas; a igualdad, la que trae costo unitario.
    if (!best || rows.length > best.rows.length || (rows.length === best.rows.length && conCosto > best.conCosto)) {
      best = { rows, conCosto, sheetName: c.name };
    }
  }
  return best;
}

/**
 * Cierre de la importación con checklist documental (se habilita al pasar a
 * 'entregado'). El backend re-valida todo en cerrar_importacion(); esta UI
 * muestra el progreso y sube los archivos al bucket privado.
 *
 * El EXCEL DE COSTEO es además FUENTE DE VERDAD: al subirlo se parsea con las
 * heurísticas del packing list y se ofrece aplicarlo a import_items
 * (referencias + unidades + costo unitario) — de ahí salen la entrada a
 * inventario por variante, la cobertura y el landed cost.
 */
export default function ImportCierreSection({ importId, cerrada, cerradaAt, estado, esAdmin, paymentsCount }: Props) {
  const { docs, upload, remove, view, cerrar, reabrir } = useImportDocuments(importId);
  const { items: itemsActuales, hayPacking, importItemSet } = useImportItems(importId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingTipo, setUploadingTipo] = useState<ImportDocTipo | null>(null);
  const [costeoParsed, setCosteoParsed] = useState<CosteoParse | null>(null);
  const [costeoWarn, setCosteoWarn] = useState<string | null>(null);

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
    const tipo = uploadingTipo;
    await upload.mutateAsync({ tipo, file });
    setUploadingTipo(null);
    // El excel de costeo también se LEE: referencias, unidades y costo
    // unitario listos para aplicar al costeo del contenedor.
    if (tipo === 'costeo_excel') {
      setCosteoParsed(null);
      setCosteoWarn(null);
      try {
        const parsed = await parseCosteoFile(file);
        if (parsed) setCosteoParsed(parsed);
        else setCosteoWarn('No encontré una tabla con columna de Referencia en ese archivo — el documento quedó subido; si querés cargar el costeo, usá "Importar CSV/Excel" en la pestaña Costeo (ahí podés mapear columnas a mano).');
      } catch (e) {
        setCosteoWarn(`El documento quedó subido, pero no pude leerlo como tabla: ${e instanceof Error ? e.message : 'archivo inválido'}`);
      }
    }
  };

  const aplicarCosteo = () => {
    if (!costeoParsed) return;
    const n = costeoParsed.rows.length;
    const existentes = itemsActuales.filter(i => (i.source ?? 'packing') === 'packing').length;
    const msg = hayPacking && existentes > 0
      ? `Vas a REEMPLAZAR las ${existentes} filas del packing/costeo actual por las ${n} referencias del excel (con su costo unitario). ¿Continuar?`
      : `Vas a cargar ${n} referencias del excel como costeo del contenedor. ¿Continuar?`;
    if (!window.confirm(msg)) return;
    importItemSet.mutate(
      { rows: costeoParsed.rows, source: 'packing', replace: hayPacking && existentes > 0 },
      { onSuccess: () => setCosteoParsed(null) },
    );
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

              {/* El excel de costeo como FUENTE DE VERDAD del contenedor */}
              {item.tipo === 'costeo_excel' && costeoParsed && (
                <div className="mt-2 ml-6 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 space-y-1.5">
                  <p className="text-[11px] leading-relaxed">
                    <FileSpreadsheet className="h-3.5 w-3.5 inline mr-1 text-primary" />
                    Leí <strong>{costeoParsed.rows.length} referencias</strong>
                    {costeoParsed.sheetName ? <> (hoja "{costeoParsed.sheetName}")</> : null} —{' '}
                    {costeoParsed.conCosto} con costo unitario,{' '}
                    {costeoParsed.rows.reduce((s, r) => s + Number(r.cantidad ?? 0), 0).toLocaleString('es-CO')} unidades en total.
                    Aplicalo y de ahí salen inventario, cobertura y landed cost.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button" size="sm" className="h-7 text-xs gap-1"
                      onClick={aplicarCosteo}
                      disabled={importItemSet.isPending}
                    >
                      {importItemSet.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      {hayPacking ? 'Aplicar (reemplaza el costeo actual)' : 'Aplicar como costeo del contenedor'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCosteoParsed(null)}>
                      Solo guardar el archivo
                    </Button>
                  </div>
                </div>
              )}
              {item.tipo === 'costeo_excel' && costeoWarn && (
                <p className="mt-1.5 ml-6 text-[11px] text-amber-600 leading-relaxed">{costeoWarn}</p>
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
