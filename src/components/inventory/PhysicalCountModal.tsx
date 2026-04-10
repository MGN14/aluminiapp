import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, CheckCircle2, XCircle, AlertTriangle, Search, Download, ClipboardCheck } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import {
  detectPhysicalMapping, buildPhysicalRows, markPhysicalDuplicates,
  crossReferenceWithInventory, type PhysicalColumnMapping, type PhysicalField,
  type PhysicalCountRow, type ExistingProduct, PHYSICAL_COLUMN_ALIASES,
} from '@/lib/physicalCountUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'done';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; }
    else if ((char === ',' || char === ';') && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += char; }
  }
  result.push(current.trim());
  return result;
}

export default function PhysicalCountModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<PhysicalColumnMapping[]>([]);
  const [rows, setRows] = useState<PhysicalCountRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState({ updated: 0, notFound: 0, errors: 0 });

  const reset = () => {
    setStep('upload');
    setHeaders([]);
    setRawRows([]);
    setMapping([]);
    setRows([]);
    setUploading(false);
    setResult({ updated: 0, notFound: 0, errors: 0 });
  };

  const processFile = useCallback(async (file: File) => {
    const isCSV = file.name.toLowerCase().endsWith('.csv');
    try {
      let detectedHeaders: string[];
      let dataRows: unknown[][];

      if (isCSV) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          toast({ title: 'Archivo vacío', variant: 'destructive' });
          return;
        }
        detectedHeaders = parseCSVLine(lines[0]);
        dataRows = lines.slice(1).map(l => parseCSVLine(l));
      } else {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string) as any;
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (jsonRows.length < 2) {
          toast({ title: 'Archivo vacío', variant: 'destructive' });
          return;
        }
        detectedHeaders = (jsonRows[0] as unknown[]).map((c: unknown) => String(c ?? ''));
        dataRows = jsonRows.slice(1) as unknown[][];
      }

      dataRows = dataRows.filter(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''));
      setHeaders(detectedHeaders);
      setRawRows(dataRows);
      setMapping(detectPhysicalMapping(detectedHeaders));
      setStep('mapping');
    } catch {
      toast({ title: 'Error al leer archivo', variant: 'destructive' });
    }
  }, [toast]);

  const onDrop = useCallback((files: File[]) => {
    if (files[0]) processFile(files[0]);
  }, [processFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
    maxFiles: 1,
  });

  const handleMappingChange = (idx: number, field: PhysicalField | null) => {
    setMapping(prev => prev.map((m, i) => i === idx ? { ...m, mappedTo: field } : m));
  };

  const handleMappingConfirm = async () => {
    if (!user) return;
    const hasRef = mapping.some(m => m.mappedTo === 'referencia');
    const hasQty = mapping.some(m => m.mappedTo === 'unidades_fisicas');
    if (!hasRef || !hasQty) {
      toast({ title: 'Mapeo incompleto', description: 'Necesitas mapear al menos "referencia" y "unidades_fisicas".', variant: 'destructive' });
      return;
    }

    const parsed = buildPhysicalRows(rawRows, mapping, 2);
    const withDups = markPhysicalDuplicates(parsed);

    // Fetch existing products
    const { data: existing } = await supabase
      .from('inventory_products')
      .select('id, reference, stock_system, name')
      .eq('user_id', user.id)
      .eq('active', true);

    const crossed = crossReferenceWithInventory(withDups, (existing || []) as ExistingProduct[]);
    setRows(crossed);
    setStep('preview');
  };

  const handleImport = async () => {
    if (!user) return;
    setUploading(true);

    const matched = rows.filter(r => r.status === 'matched' && r.existingProductId);
    let updated = 0;
    let errors = 0;

    // Resolve duplicates by summing
    const deduped = new Map<string, PhysicalCountRow>();
    for (const r of matched) {
      const key = r.existingProductId!;
      if (deduped.has(key)) {
        const prev = deduped.get(key)!;
        deduped.set(key, { ...prev, unidades_fisicas: prev.unidades_fisicas + r.unidades_fisicas });
      } else {
        deduped.set(key, r);
      }
    }

    for (let batch of chunk(Array.from(deduped.values()), 50)) {
      for (const r of batch) {
        const { error } = await supabase
          .from('inventory_products')
          .update({ stock_physical: r.unidades_fisicas, last_count_date: new Date().toISOString() })
          .eq('id', r.existingProductId!)
          .eq('user_id', user.id);
        if (error) errors++;
        else updated++;
      }
    }

    const notFound = rows.filter(r => r.status === 'not_found').length;
    const errorCount = rows.filter(r => r.status === 'error').length + errors;

    setResult({ updated, notFound, errors: errorCount });
    setStep('done');
    setUploading(false);
    if (updated > 0) onComplete();
  };

  const matchedCount = rows.filter(r => r.status === 'matched').length;
  const notFoundCount = rows.filter(r => r.status === 'not_found').length;
  const errorCount = rows.filter(r => r.status === 'error').length;
  const dupCount = rows.filter(r => r.status === 'duplicate').length;

  const downloadTemplate = () => {
    const csv = `referencia,unidades_fisicas,nombre_producto\nREF-001,148,Perfil T6 Natural\nREF-002,82,Lámina Lisa 1mm`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_inventario_fisico.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrors = () => {
    const errRows = rows.filter(r => r.status !== 'matched');
    if (!errRows.length) return;
    const header = 'fila,referencia,estado,error\n';
    const csvRows = errRows.map(r =>
      `${r.rowNumber},"${r.referencia}","${r.status}","${r.issues.join('; ')}"`
    ).join('\n');
    const blob = new Blob([header + csvRows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'errores_conteo_fisico.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const fieldOptions = Object.keys(PHYSICAL_COLUMN_ALIASES) as PhysicalField[];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-amber-400" />
            {step === 'upload' && 'Cargar inventario físico'}
            {step === 'mapping' && 'Mapeo de columnas'}
            {step === 'preview' && 'Cruce con inventario contable'}
            {step === 'done' && 'Conteo importado'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Sube el conteo real de bodega para compararlo con el inventario del sistema'}
            {step === 'mapping' && 'Confirma que las columnas de referencia y cantidad están correctas'}
            {step === 'preview' && 'Revisa el cruce entre el conteo físico y el inventario contable de Siigo'}
            {step === 'done' && 'Las unidades físicas fueron actualizadas'}
          </DialogDescription>
        </DialogHeader>

        {/* STEP: UPLOAD */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                isDragActive ? 'border-amber-400 bg-amber-400/5' : 'border-border hover:border-amber-400/40'
              }`}
            >
              <input {...getInputProps()} />
              <ClipboardCheck className="h-8 w-8 mx-auto mb-3 text-amber-400/60" />
              <p className="text-sm font-medium">Arrastra tu archivo de conteo físico</p>
              <p className="text-xs text-muted-foreground mt-1">Excel o CSV con referencia y unidades contadas</p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2 w-full">
              <Download className="h-3.5 w-3.5" />
              Descargar plantilla conteo físico
            </Button>
            <div className="text-xs text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-1">
              <p className="font-medium text-amber-400">⚠️ Este conteo NO reemplaza el inventario contable</p>
              <p>Solo actualiza las unidades físicas para comparar contra el sistema de Siigo y detectar diferencias operativas.</p>
            </div>
          </div>
        )}

        {/* STEP: MAPPING */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="space-y-2">
              {mapping.map((m, idx) => (
                <div key={idx} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-xs bg-muted/40 rounded px-2 py-1 min-w-[140px] truncate">{m.excelHeader}</span>
                  <span className="text-muted-foreground">→</span>
                  <Select value={m.mappedTo || '__none''} onValueChange={(v) => handleMappingChange(idx, v === '__none' ? null : v as PhysicalField)}>
                    <SelectTrigger className="h-8 text-xs w-48">
                      <SelectValue placeholder="No mapear" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No mapear</SelectItem>
                      {fieldOptions.map(f => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.mappedTo && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">✓</Badge>}
                </div>
              ))}
            </div>
            {rawRows.length > 0 && (
              <p className="text-xs text-muted-foreground">{rawRows.length} filas detectadas</p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={reset} className="flex-1">Atrás</Button>
              <Button onClick={handleMappingConfirm} className="flex-1">Validar cruce</Button>
            </div>
          </div>
        )}

        {/* STEP: PREVIEW */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span className="text-emerald-400 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {matchedCount} cruzados</span>
              {notFoundCount > 0 && <span className="text-amber-400 font-medium flex items-center gap-1"><Search className="h-3 w-3" /> {notFoundCount} no encontrados</span>}
              {errorCount > 0 && <span className="text-destructive font-medium flex items-center gap-1"><XCircle className="h-3 w-3" /> {errorCount} errores</span>}
              {dupCount > 0 && <span className="text-amber-400 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {dupCount} duplicados (se sumarán)</span>}
              <span className="text-muted-foreground ml-auto">{rows.length} filas total</span>
            </div>

            <div className="max-h-60 overflow-auto rounded-xl border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Ref.</TableHead>
                    <TableHead className="text-right">Uds. Sistema</TableHead>
                    <TableHead className="text-right">Uds. Físicas</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 30).map((r, i) => (
                    <TableRow key={i} className={
                      r.status === 'error' ? 'bg-destructive/5' :
                      r.status === 'not_found' ? 'bg-amber-500/5' :
                      r.status === 'duplicate' ? 'bg-amber-500/5' : ''
                    }>
                      <TableCell className="font-mono text-xs">{r.referencia || '—'}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{r.existingStock?.toLocaleString('es-CO') ?? '—'}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{r.unidades_fisicas.toLocaleString('es-CO')}</TableCell>
                      <TableCell className={`text-right text-xs font-mono font-medium ${
                        r.difference === undefined ? 'text-muted-foreground' :
                        r.difference === 0 ? 'text-emerald-400' :
                        r.difference > 0 ? 'text-destructive' : 'text-amber-400'
                      }`}>
                        {r.difference !== undefined ? (r.difference > 0 ? `+${r.difference}` : r.difference === 0 ? '0' : r.difference) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${
                          r.status === 'matched' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                          r.status === 'not_found' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                          r.status === 'duplicate' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                          'bg-destructive/10 text-destructive border-destructive/30'
                        }`}>
                          {r.status === 'matched' ? 'OK' : r.status === 'not_found' ? 'No encontrada' : r.status === 'duplicate' ? 'Duplicada' : r.issues[0]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 30 && <p className="text-xs text-muted-foreground text-center py-2">+{rows.length - 30} más...</p>}
            </div>

            {notFoundCount > 0 && (
              <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                <p className="font-medium">⚠️ {notFoundCount} referencias no existen en el inventario contable de Siigo</p>
                <p className="text-muted-foreground mt-1">Estas referencias serán ignoradas. Primero cárgalas desde Siigo.</p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('mapping')} className="flex-1">Atrás</Button>
              <Button onClick={handleImport} disabled={uploading || matchedCount === 0} className="flex-1 gap-2">
                {uploading ? 'Importando...' : `Actualizar ${matchedCount} productos`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP: DONE */}
        {step === 'done' && (
          <div className="text-center space-y-4 py-6">
            <CheckCircle2 className="h-12 w-12 mx-auto text-amber-400" />
            <div>
              <p className="text-lg font-semibold">{result.updated} productos actualizados</p>
              <p className="text-sm text-muted-foreground mt-1">Las unidades físicas fueron registradas</p>
              {result.notFound > 0 && (
                <p className="text-xs text-amber-400 mt-1">{result.notFound} referencias no encontradas en Siigo</p>
              )}
            </div>
            {(result.notFound > 0 || result.errors > 0) && (
              <Button variant="outline" size="sm" onClick={downloadErrors} className="gap-2">
                <Download className="h-3.5 w-3.5" />
                Descargar reporte
              </Button>
            )}
            <Button onClick={() => { reset(); onOpenChange(false); }} className="w-full">Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}
