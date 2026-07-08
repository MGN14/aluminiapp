import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileSpreadsheet, ClipboardPaste, AlertCircle, ArrowRight } from 'lucide-react';
import { parseDelimited, parseLooseNumber } from '@/lib/delimitedParser';
import { guessMapping, isSummaryReference, hasAnyData, type FieldKey } from '@/lib/packingListParse';
import { suffixColorConflict } from '@/lib/refFamily';
import { readXlsxFile, isExcelFile, type XlsxSheet } from '@/lib/readXlsx';
import type { NewImportItem } from '@/hooks/useImportItems';

const FIELD_LABEL: Record<FieldKey, string> = {
  reference: 'Referencia *',
  descripcion: 'Descripción',
  cantidad: 'Cantidad *',
  unidad: 'Unidad',
  peso_kg: 'Peso (kg)',
  fob_total_usd: 'FOB total (USD) *',
  color: 'Color',
  bultos: 'Bultos/Bales',
  costo_unitario_excel: 'Costo unit. Excel (COP)',
  ignorar: '— Ignorar —',
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (rows: NewImportItem[]) => void;
}

type Phase = 'input' | 'sheet' | 'map';

export default function PackingListImport({ open, onOpenChange, onConfirm }: Props) {
  const [phase, setPhase] = useState<Phase>('input');
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [sheets, setSheets] = useState<XlsxSheet[]>([]);
  const [readingXlsx, setReadingXlsx] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase('input'); setPasted(''); setRows([]); setSheets([]); setReadingXlsx(false);
    setHasHeader(true); setMapping([]); setError(null);
  };

  const ingestRows = (parsed: string[][]) => {
    setError(null);
    if (parsed.length === 0) { setError('No se encontraron filas. Revisá el archivo o el texto pegado.'); return; }
    const colCount = Math.max(...parsed.map((r) => r.length));
    const header = parsed[0];
    // Auto-mapear desde el encabezado (cada campo a una sola columna).
    const guessed: FieldKey[] = guessMapping(header, colCount);
    setRows(parsed);
    setMapping(guessed);
    // Si ninguna columna del header mapeó a algo, probablemente NO hay header.
    setHasHeader(guessed.some((g) => g !== 'ignorar'));
    setPhase('map');
  };

  const ingest = (text: string) => {
    ingestRows(parseDelimited(text).rows);
  };

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);

    // Excel directo: SheetJS por import() dinámico. Con varias hojas (los
    // costeos de Nico traen "Contenedor ..." + la del proveedor) se elige cuál.
    if (isExcelFile(file)) {
      setReadingXlsx(true);
      try {
        const parsed = await readXlsxFile(file);
        if (parsed.length === 0) { setError('El Excel no tiene hojas con datos.'); return; }
        if (parsed.length === 1) { ingestRows(parsed[0].rows); return; }
        setSheets(parsed);
        setPhase('sheet');
      } catch (e) {
        setError(`No se pudo leer el Excel: ${e instanceof Error ? e.message : 'archivo inválido'}`);
      } finally {
        setReadingXlsx(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result ?? ''));
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt', '.tsv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    onDropRejected: () => setError('Formato no soportado. Vale .xlsx, .xls, .csv o pegar el rango copiado de Excel.'),
  });

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);

  const mapped: NewImportItem[] = useMemo(() => {
    const idxOf = (f: FieldKey) => mapping.indexOf(f);
    const ref = idxOf('reference'), desc = idxOf('descripcion'), cant = idxOf('cantidad');
    const uni = idxOf('unidad'), peso = idxOf('peso_kg'), fob = idxOf('fob_total_usd');
    const col = idxOf('color'), bul = idxOf('bultos'), cue = idxOf('costo_unitario_excel');
    return dataRows
      .map((r, i) => ({
        reference: (ref > -1 ? r[ref] : '')?.trim() ?? '',
        descripcion: desc > -1 ? (r[desc]?.trim() || null) : null,
        cantidad: cant > -1 ? parseLooseNumber(r[cant]) : 0,
        unidad: uni > -1 ? (r[uni]?.trim() || 'kg') : 'kg',
        // Celda de peso vacía → null (no 0): un 0 falso distorsionaría el
        // prorrateo de costos por peso (la referencia no recibiría flete).
        peso_kg: peso > -1 && r[peso]?.trim() ? parseLooseNumber(r[peso]) : null,
        fob_total_usd: fob > -1 ? parseLooseNumber(r[fob]) : 0,
        orden: i,
        notas: null,
        color: col > -1 ? (r[col]?.trim() || null) : null,
        bultos: bul > -1 && r[bul]?.trim() ? parseLooseNumber(r[bul]) : null,
        costo_unitario_excel: cue > -1 && r[cue]?.trim() ? parseLooseNumber(r[cue]) : null,
      }))
      .filter((it) =>
        it.reference.length > 0
        // Fila TOTAL/SUBTOTAL (trae números pero no es referencia)
        && !isSummaryReference(it.reference)
        // Notas al pie sin datos ("Tope contenedor: 28.400 kg", "EXCEDE TOPE")
        && hasAnyData(it),
      );
  }, [dataRows, mapping]);

  const hasRef = mapping.includes('reference');
  const hasFob = mapping.includes('fob_total_usd');
  const hasCant = mapping.includes('cantidad');

  // Consistencia sufijo ↔ Color: el proforma viene sin sufijos (China) y el
  // packing list definitivo CON sufijos + columna Color — si ambos vienen y
  // se contradicen (-3 negro con Color "Blanco"), es un error de datos que
  // hay que ver ANTES de confirmar. No bloquea: avisa.
  const colorConflicts = useMemo(
    () => mapped
      .map((it) => suffixColorConflict(it.reference, it.color ?? null))
      .filter((c): c is string => c !== null),
    [mapped],
  );

  const handleConfirm = () => {
    if (!hasRef) { setError('Indicá cuál columna es la Referencia.'); return; }
    if (mapped.length === 0) { setError('No quedó ninguna fila con referencia válida.'); return; }
    onConfirm(mapped);
    reset();
    onOpenChange(false);
  };

  const setColMapping = (colIdx: number, value: FieldKey) => {
    setMapping((prev) => {
      const next = [...prev];
      // Un campo (salvo "ignorar") solo puede estar en una columna.
      if (value !== 'ignorar') {
        for (let i = 0; i < next.length; i++) if (next[i] === value) next[i] = 'ignorar';
      }
      next[colIdx] = value;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar packing list</DialogTitle>
          <DialogDescription className="text-xs">
            Subí el CSV del proveedor o pegá el rango copiado desde Excel. Después indicás qué columna es qué.
          </DialogDescription>
        </DialogHeader>

        {phase === 'input' && (
          <div className="space-y-4">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
            >
              <input {...getInputProps()} />
              <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              {readingXlsx ? (
                <p className="text-sm font-medium">Leyendo Excel…</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{isDragActive ? 'Soltá el archivo' : 'Arrastrá el Excel (.xlsx) o CSV, o hacé clic'}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    El Excel se lee directo — si tiene varias hojas, elegís cuál. También podés pegar el rango abajo.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <ClipboardPaste className="h-3.5 w-3.5" /> O pegá desde Excel
              </Label>
              <Textarea
                rows={5}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'REF-001\tPerfil 40x40\t1200\tkg\t1200\t3120\nREF-002\tÁngulo 25\t800\tkg\t640\t1840'}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!pasted.trim()}
                onClick={() => ingest(pasted)}
              >
                Continuar con lo pegado <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>

            {error && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
          </div>
        )}

        {phase === 'sheet' && (
          <div className="space-y-3">
            <p className="text-sm">El Excel tiene {sheets.length} hojas — ¿cuál es el packing list / proforma?</p>
            <div className="space-y-2">
              {sheets.map((s) => (
                <button
                  key={s.name}
                  className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm hover:border-primary/50 hover:bg-primary/5 transition-colors text-left"
                  onClick={() => ingestRows(s.rows)}
                >
                  <span className="font-medium flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> {s.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.rows.length} filas</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>Volver</Button>
          </div>
        )}

        {phase === 'map' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                La primera fila es encabezado
              </label>
              <span className="text-muted-foreground">·</span>
              <span className={hasRef ? 'text-success' : 'text-destructive'}>
                Referencia {hasRef ? '✓' : '✗'}
              </span>
              <span className={hasCant ? 'text-success' : 'text-muted-foreground'}>Cantidad {hasCant ? '✓' : '—'}</span>
              <span className={hasFob ? 'text-success' : 'text-muted-foreground'}>FOB {hasFob ? '✓' : '—'}</span>
              <span className="text-muted-foreground ml-auto">{mapped.length} fila(s) válidas</span>
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60">
                    {mapping.map((m, col) => (
                      <TableHead key={col} className="p-1.5">
                        <Select value={m} onValueChange={(v) => setColMapping(col, v as FieldKey)}>
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FIELD_LABEL) as FieldKey[]).map((f) => (
                              <SelectItem key={f} value={f} className="text-xs">{FIELD_LABEL[f]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataRows.slice(0, 6).map((r, ri) => (
                    <TableRow key={ri}>
                      {mapping.map((_, col) => (
                        <TableCell key={col} className="text-[11px] font-mono whitespace-nowrap py-1">
                          {r[col] ?? ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {dataRows.length > 6 && (
              <p className="text-[11px] text-muted-foreground">Mostrando 6 de {dataRows.length} filas.</p>
            )}

            {colorConflicts.length > 0 && (
              <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-0.5">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {colorConflicts.length} fila{colorConflicts.length > 1 ? 's' : ''} con sufijo y color que no cuadran — revisá antes de confirmar:
                </p>
                {colorConflicts.slice(0, 5).map((c, i) => <p key={i}>· {c}</p>)}
                {colorConflicts.length > 5 && <p>· … y {colorConflicts.length - 5} más</p>}
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </p>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>Volver</Button>
              <Button size="sm" onClick={handleConfirm} disabled={!hasRef || mapped.length === 0}>
                Agregar {mapped.length} referencia{mapped.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
