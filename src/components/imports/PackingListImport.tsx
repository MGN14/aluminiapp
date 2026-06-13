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
import type { NewImportItem } from '@/hooks/useImportItems';

type FieldKey = 'reference' | 'descripcion' | 'cantidad' | 'unidad' | 'peso_kg' | 'fob_total_usd' | 'ignorar';

const FIELD_LABEL: Record<FieldKey, string> = {
  reference: 'Referencia *',
  descripcion: 'Descripción',
  cantidad: 'Cantidad *',
  unidad: 'Unidad',
  peso_kg: 'Peso (kg)',
  fob_total_usd: 'FOB total (USD) *',
  ignorar: '— Ignorar —',
};

// Heurística para auto-mapear columnas por el nombre del encabezado.
function guessField(header: string): FieldKey {
  const h = header.toLowerCase().trim();
  if (/(ref|código|codigo|item|sku|perfil)/.test(h)) return 'reference';
  if (/(desc|nombre|product|descripc)/.test(h)) return 'descripcion';
  if (/(peso|weight|kg|kgs|net)/.test(h)) return 'peso_kg';
  if (/(fob|valor|amount|total|price|precio|usd)/.test(h)) return 'fob_total_usd';
  if (/(unidad|unit|medida|uom)/.test(h)) return 'unidad';
  if (/(cant|qty|quantity|pcs|pzas|piezas|bultos|cajas)/.test(h)) return 'cantidad';
  return 'ignorar';
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (rows: NewImportItem[]) => void;
}

type Phase = 'input' | 'map';

export default function PackingListImport({ open, onOpenChange, onConfirm }: Props) {
  const [phase, setPhase] = useState<Phase>('input');
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase('input'); setPasted(''); setRows([]); setHasHeader(true); setMapping([]); setError(null);
  };

  const ingest = (text: string) => {
    setError(null);
    const { rows: parsed } = parseDelimited(text);
    if (parsed.length === 0) { setError('No se encontraron filas. Revisá el archivo o el texto pegado.'); return; }
    const colCount = Math.max(...parsed.map((r) => r.length));
    const header = parsed[0];
    // Auto-mapear desde el encabezado.
    const guessed: FieldKey[] = Array.from({ length: colCount }, (_, i) => guessField(header[i] ?? ''));
    setRows(parsed);
    setMapping(guessed);
    // Si ninguna columna del header mapeó a algo, probablemente NO hay header.
    setHasHeader(guessed.some((g) => g !== 'ignorar'));
    setPhase('map');
  };

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result ?? ''));
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt', '.tsv'] },
  });

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);

  const mapped: NewImportItem[] = useMemo(() => {
    const idxOf = (f: FieldKey) => mapping.indexOf(f);
    const ref = idxOf('reference'), desc = idxOf('descripcion'), cant = idxOf('cantidad');
    const uni = idxOf('unidad'), peso = idxOf('peso_kg'), fob = idxOf('fob_total_usd');
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
      }))
      .filter((it) => it.reference.length > 0);
  }, [dataRows, mapping]);

  const hasRef = mapping.includes('reference');
  const hasFob = mapping.includes('fob_total_usd');
  const hasCant = mapping.includes('cantidad');

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
              <p className="text-sm font-medium">{isDragActive ? 'Soltá el archivo' : 'Arrastrá el CSV o hacé clic'}</p>
              <p className="text-xs text-muted-foreground mt-1">
                ¿Tenés un .xlsx? Guardalo como CSV, o copiá el rango y pegalo abajo.
              </p>
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
