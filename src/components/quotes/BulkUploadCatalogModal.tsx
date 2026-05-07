import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface ParsedRow {
  rowNumber: number;
  system: string;
  color: string;
  price_per_m2: number;
  description: string | null;
  issues: string[];
  isDuplicate: boolean;
}

type Step = 'upload' | 'preview' | 'done';
type DuplicateAction = 'update' | 'skip';

const HEADER_ALIASES = {
  system: ['sistema', 'system', 'serie', 'linea', 'línea'],
  color: ['color', 'colour'],
  price: ['precio', 'precio_m2', 'precio m2', 'precio por m2', 'price_per_m2', 'price', 'valor', 'valor_m2'],
  description: ['descripcion', 'descripción', 'description', 'desc', 'nota', 'notas'],
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === ';') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function detectColumn(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().trim());
  for (const a of aliases) {
    const idx = norm.indexOf(a);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parsePrice(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN;
  const str = String(raw).replace(/[\s$]/g, '').replace(/\./g, '').replace(/,/g, '.');
  const n = Number(str);
  return Number.isFinite(n) ? n : NaN;
}

export default function BulkUploadCatalogModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>('update');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState({ inserted: 0, updated: 0, skipped: 0, errors: 0 });

  const reset = () => {
    setStep('upload');
    setFileName('');
    setRows([]);
    setDuplicateAction('update');
    setImporting(false);
    setResult({ inserted: 0, updated: 0, skipped: 0, errors: 0 });
  };

  const processFile = useCallback(
    async (file: File) => {
      if (!user) return;
      setFileName(file.name);
      const isCSV = file.name.toLowerCase().endsWith('.csv');

      try {
        let headers: string[];
        let dataRows: unknown[][];

        if (isCSV) {
          const text = await file.text();
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length < 2) {
            toast({
              title: 'Archivo vacío',
              description: 'Necesitás al menos una fila de encabezados y una de datos.',
              variant: 'destructive',
            });
            return;
          }
          headers = parseCSVLine(lines[0]);
          dataRows = lines.slice(1).map((l) => parseCSVLine(l));
        } else {
          const XLSX = (await import(
            'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string
          )) as any;
          const data = await file.arrayBuffer();
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.SheetNames?.[0];
          if (!sheet) {
            toast({ title: 'Excel sin hojas', variant: 'destructive' });
            return;
          }
          const ws = wb.Sheets[sheet];
          const json: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (json.length < 2) {
            toast({ title: 'Archivo vacío', variant: 'destructive' });
            return;
          }
          headers = (json[0] as unknown[]).map((c: unknown) => String(c ?? ''));
          dataRows = json.slice(1) as unknown[][];
        }

        const idxSystem = detectColumn(headers, HEADER_ALIASES.system);
        const idxColor = detectColumn(headers, HEADER_ALIASES.color);
        const idxPrice = detectColumn(headers, HEADER_ALIASES.price);
        const idxDesc = detectColumn(headers, HEADER_ALIASES.description);

        if (idxSystem === -1 || idxColor === -1 || idxPrice === -1) {
          toast({
            title: 'Encabezados no detectados',
            description: 'Necesitamos columnas: sistema, color y precio (o sus variantes).',
            variant: 'destructive',
          });
          return;
        }

        // Fetch existing for duplicate detection
        const { data: existing } = await (supabase
          .from('aluminum_catalog' as never)
          .select('system, color') as any);
        const existingSet = new Set<string>(
          ((existing as { system: string; color: string }[] | null) ?? []).map(
            (e) => `${e.system.toLowerCase()}|${e.color.toLowerCase()}`,
          ),
        );

        const parsed: ParsedRow[] = dataRows
          .filter((row) =>
            row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''),
          )
          .map((row, i) => {
            const system = String(row[idxSystem] ?? '').trim();
            const color = String(row[idxColor] ?? '').trim();
            const priceRaw = row[idxPrice];
            const price = parsePrice(priceRaw);
            const description = idxDesc !== -1 ? String(row[idxDesc] ?? '').trim() || null : null;

            const issues: string[] = [];
            if (!system) issues.push('Falta sistema');
            if (!color) issues.push('Falta color');
            if (!Number.isFinite(price) || price <= 0) issues.push('Precio inválido');

            const key = `${system.toLowerCase()}|${color.toLowerCase()}`;
            const isDuplicate = issues.length === 0 && existingSet.has(key);

            return {
              rowNumber: i + 2,
              system,
              color,
              price_per_m2: price,
              description,
              issues,
              isDuplicate,
            };
          });

        setRows(parsed);
        setStep('preview');
      } catch (err) {
        console.error('Catalog upload parse error:', err);
        toast({
          title: 'Error al leer archivo',
          description: 'Verificá el formato (CSV o Excel) y los encabezados.',
          variant: 'destructive',
        });
      }
    },
    [toast, user],
  );

  const handleImport = async () => {
    if (!user) return;
    setImporting(true);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const valid = rows.filter((r) => r.issues.length === 0);
    const invalid = rows.length - valid.length;
    errors += invalid;

    try {
      // Fetch full existing rows for case-insensitive matching
      const { data: existing } = await (supabase
        .from('aluminum_catalog' as never)
        .select('id, system, color') as any);
      const existingMap = new Map<string, string>(
        ((existing as { id: string; system: string; color: string }[] | null) ?? []).map((e) => [
          `${e.system.toLowerCase()}|${e.color.toLowerCase()}`,
          e.id,
        ]),
      );

      const toInsert: {
        user_id: string;
        system: string;
        color: string;
        price_per_m2: number;
        description: string | null;
      }[] = [];
      const toUpdate: { id: string; price_per_m2: number; description: string | null }[] = [];

      for (const r of valid) {
        const key = `${r.system.toLowerCase()}|${r.color.toLowerCase()}`;
        const existingId = existingMap.get(key);
        if (existingId) {
          if (duplicateAction === 'update') {
            toUpdate.push({
              id: existingId,
              price_per_m2: r.price_per_m2,
              description: r.description,
            });
          } else {
            skipped++;
          }
        } else {
          toInsert.push({
            user_id: user.id,
            system: r.system,
            color: r.color,
            price_per_m2: r.price_per_m2,
            description: r.description,
          });
        }
      }

      // Insert in batches of 50
      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const { error } = await (supabase
          .from('aluminum_catalog' as never)
          .insert(batch as never) as any);
        if (error) {
          errors += batch.length;
          console.error('Catalog insert error:', error);
        } else {
          inserted += batch.length;
        }
      }

      // Update existing one by one (small dataset, no batch update available)
      for (const u of toUpdate) {
        const { error } = await (supabase
          .from('aluminum_catalog' as never)
          .update({ price_per_m2: u.price_per_m2, description: u.description } as never)
          .eq('id', u.id) as any);
        if (error) {
          errors++;
          console.error('Catalog update error:', error);
        } else {
          updated++;
        }
      }
    } catch (err) {
      console.error('Catalog bulk import error:', err);
      errors++;
    }

    setResult({ inserted, updated, skipped, errors });
    setStep('done');
    setImporting(false);
    if (inserted + updated > 0) onComplete();
  };

  const validCount = rows.filter((r) => r.issues.length === 0).length;
  const dupCount = rows.filter((r) => r.isDuplicate).length;
  const invalidCount = rows.filter((r) => r.issues.length > 0).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Carga masiva del catálogo'}
            {step === 'preview' && 'Validación de productos'}
            {step === 'done' && 'Importación completada'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' &&
              'CSV o Excel con columnas: sistema, color, precio (m²) y descripción (opcional).'}
            {step === 'preview' && `Archivo: ${fileName}`}
            {step === 'done' && 'Resumen:'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-3">
            <label
              htmlFor="catalog-file"
              className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/50 transition"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Seleccionar archivo</span>
              <span className="text-xs text-muted-foreground">.csv, .xlsx</span>
              <input
                id="catalog-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                }}
              />
            </label>
            <div className="text-xs text-muted-foreground rounded-md bg-muted/40 p-3 space-y-1">
              <p className="font-medium">Ejemplo de formato:</p>
              <pre className="text-[10px] font-mono">
{`sistema,color,precio_m2,descripcion
744,Blanco,180000,Línea económica
744,Bronce,195000,
Eurovent,Natural,250000,Premium`}
              </pre>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border p-2">
                <div className="text-2xl font-semibold">{validCount}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Válidos</div>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-2">
                <div className="text-2xl font-semibold text-amber-700 dark:text-amber-400">
                  {dupCount}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">Duplicados</div>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-2">
                <div className="text-2xl font-semibold text-red-700 dark:text-red-400">
                  {invalidCount}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">Con error</div>
              </div>
            </div>

            {dupCount > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  <span className="text-sm font-medium">¿Qué hacer con duplicados?</span>
                </div>
                <RadioGroup
                  value={duplicateAction}
                  onValueChange={(v) => setDuplicateAction(v as DuplicateAction)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="update" id="dup-update" />
                    <Label htmlFor="dup-update" className="text-xs cursor-pointer">
                      Actualizar precio del existente
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="skip" id="dup-skip" />
                    <Label htmlFor="dup-skip" className="text-xs cursor-pointer">
                      Saltar (mantener existente sin cambios)
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            <div className="border border-border rounded-md max-h-[300px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Fila</th>
                    <th className="text-left p-2">Sistema</th>
                    <th className="text-left p-2">Color</th>
                    <th className="text-right p-2">Precio/m²</th>
                    <th className="text-left p-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-border">
                      <td className="p-2 text-muted-foreground tabular-nums">{r.rowNumber}</td>
                      <td className="p-2">{r.system || '—'}</td>
                      <td className="p-2">{r.color || '—'}</td>
                      <td className="p-2 text-right tabular-nums">
                        {Number.isFinite(r.price_per_m2)
                          ? r.price_per_m2.toLocaleString('es-CO', {
                              style: 'currency',
                              currency: 'COP',
                              maximumFractionDigits: 0,
                            })
                          : '—'}
                      </td>
                      <td className="p-2">
                        {r.issues.length > 0 ? (
                          <span className="text-red-600 text-[10px]">{r.issues.join(', ')}</span>
                        ) : r.isDuplicate ? (
                          <span className="text-amber-600 text-[10px]">Duplicado</span>
                        ) : (
                          <span className="text-green-600 text-[10px]">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="outline" size="sm" onClick={reset} disabled={importing}>
                Cargar otro archivo
              </Button>
              <Button onClick={handleImport} disabled={importing || validCount === 0}>
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Importar {validCount} producto{validCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 py-4">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
              <span className="text-lg font-medium">Importación completada</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-md border border-border p-2">
                <div className="text-xl font-semibold text-green-600">{result.inserted}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Nuevos</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-xl font-semibold text-blue-600">{result.updated}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Actualizados</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-xl font-semibold text-muted-foreground">{result.skipped}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Saltados</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-xl font-semibold text-red-600">{result.errors}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Errores</div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                <FileText className="h-4 w-4 mr-1.5" />
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
