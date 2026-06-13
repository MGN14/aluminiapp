import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileSpreadsheet, ClipboardPaste, AlertCircle, ArrowRight } from 'lucide-react';
import { parseDelimited, parseLooseNumber } from '@/lib/delimitedParser';
import type { TrialBalanceImportRow } from '@/hooks/useExternalTrialBalance';

type FieldKey = 'account_code' | 'account_name' | 'saldo' | 'ignorar';
const FIELD_LABEL: Record<FieldKey, string> = {
  account_code: 'Código cuenta *',
  account_name: 'Nombre cuenta',
  saldo: 'Saldo *',
  ignorar: '— Ignorar —',
};

function guess(header: string): FieldKey {
  const h = header.toLowerCase().trim();
  // Movimientos y saldos intermedios NO son el saldo final → ignorar.
  if (/(d[eé]bito|cr[eé]dito|movim|\bdebe\b|\bhaber\b)/.test(h)) return 'ignorar';
  // Saldo / valor del periodo actual (Siigo exporta la columna como "Año actual").
  if (/(saldo|valor|a[ñn]o\s*actual|nuevo\s*saldo)/.test(h)) {
    if (/(anterior|inicial|\binic|apertura)/.test(h)) return 'ignorar';
    return 'saldo';
  }
  // Nombre antes que 'cuenta' para que 'nombre cuenta' → nombre.
  if (/(nombre|descrip|name|concepto)/.test(h)) return 'account_name';
  if (/(c[oó]digo|\bcod\b|puc|code|cuenta)/.test(h)) return 'account_code';
  return 'ignorar';
}

/** Si el auto-guess marcó un campo en >1 columna, dejar una sola: para saldo
 *  la más a la derecha (saldo final suele ir al final), para código/nombre la
 *  primera. Evita que se compare el saldo equivocado. */
function dedupeGuess(guessed: FieldKey[]): FieldKey[] {
  const out = [...guessed];
  for (const field of ['account_code', 'account_name', 'saldo'] as const) {
    const idxs = out.map((g, i) => (g === field ? i : -1)).filter((i) => i >= 0);
    if (idxs.length > 1) {
      const keep = field === 'saldo' ? idxs[idxs.length - 1] : idxs[0];
      for (const i of idxs) if (i !== keep) out[i] = 'ignorar';
    }
  }
  return out;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (rows: TrialBalanceImportRow[], snapshotDate: string | null) => void;
}

export default function TrialBalanceImport({ open, onOpenChange, onConfirm }: Props) {
  const [phase, setPhase] = useState<'input' | 'map'>('input');
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [snapshotDate, setSnapshotDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setPhase('input'); setPasted(''); setRows([]); setHasHeader(true); setMapping([]); setError(null); };

  const ingest = (text: string) => {
    setError(null);
    const { rows: parsed } = parseDelimited(text);
    if (parsed.length === 0) { setError('No se encontraron filas.'); return; }
    const colCount = Math.max(...parsed.map((r) => r.length));
    const guessed = dedupeGuess(Array.from({ length: colCount }, (_, i) => guess(parsed[0][i] ?? '')));
    setRows(parsed);
    setMapping(guessed);
    setHasHeader(guessed.some((g) => g !== 'ignorar'));
    setPhase('map');
  };

  const onDrop = useCallback((files: File[]) => {
    const f = files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result ?? ''));
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsText(f);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false, accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt', '.tsv'] } });

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);
  const mapped: TrialBalanceImportRow[] = useMemo(() => {
    const idx = (f: FieldKey) => mapping.indexOf(f);
    const code = idx('account_code'), name = idx('account_name'), saldo = idx('saldo');
    return dataRows
      .map((r) => ({
        account_code: (code > -1 ? r[code] : '')?.trim() ?? '',
        account_name: name > -1 ? (r[name]?.trim() || null) : null,
        saldo: saldo > -1 ? parseLooseNumber(r[saldo]) : 0,
      }))
      .filter((x) => x.account_code.length > 0);
  }, [dataRows, mapping]);

  const hasCode = mapping.includes('account_code');
  const hasSaldo = mapping.includes('saldo');

  const setCol = (col: number, v: FieldKey) => setMapping((prev) => {
    const next = [...prev];
    if (v !== 'ignorar') for (let i = 0; i < next.length; i++) if (next[i] === v) next[i] = 'ignorar';
    next[col] = v; return next;
  });

  const handleConfirm = () => {
    if (!hasCode || !hasSaldo) { setError('Indicá las columnas de Código y Saldo.'); return; }
    if (mapped.length === 0) { setError('No quedó ninguna fila con cuenta válida.'); return; }
    onConfirm(mapped, snapshotDate || null);
    reset(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar balance de prueba de Siigo</DialogTitle>
          <DialogDescription className="text-xs">
            En Siigo: Contabilidad → Informes → Balance de prueba → exportar a Excel. Guardalo como CSV y subilo, o copiá las columnas (código, nombre, saldo) y pegalas.
          </DialogDescription>
        </DialogHeader>

        {phase === 'input' && (
          <div className="space-y-4">
            <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
              <input {...getInputProps()} />
              <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{isDragActive ? 'Soltá el archivo' : 'Arrastrá el CSV o hacé clic'}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5"><ClipboardPaste className="h-3.5 w-3.5" /> O pegá desde Excel</Label>
              <Textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)}
                placeholder={'110505\tCaja general\t12500000\n130505\tClientes nacionales\t8400000'}
                className="font-mono text-xs" />
              <Button size="sm" variant="outline" disabled={!pasted.trim()} onClick={() => ingest(pasted)}>
                Continuar con lo pegado <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
            {error && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>}
          </div>
        )}

        {phase === 'map' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> Primera fila es encabezado
              </label>
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px]">Fecha de corte</Label>
                <Input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} className="h-7 w-36 text-xs" />
              </div>
              <span className="text-muted-foreground ml-auto">{mapped.length} cuentas</span>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60">
                    {mapping.map((m, col) => (
                      <TableHead key={col} className="p-1.5">
                        <Select value={m} onValueChange={(v) => setCol(col, v as FieldKey)}>
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FIELD_LABEL) as FieldKey[]).map((f) => <SelectItem key={f} value={f} className="text-xs">{FIELD_LABEL[f]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataRows.slice(0, 6).map((r, ri) => (
                    <TableRow key={ri}>{mapping.map((_, col) => <TableCell key={col} className="text-[11px] font-mono whitespace-nowrap py-1">{r[col] ?? ''}</TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {error && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>Volver</Button>
              <Button size="sm" onClick={handleConfirm} disabled={!hasCode || !hasSaldo || mapped.length === 0}>Importar {mapped.length} cuentas</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
