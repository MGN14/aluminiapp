import { useCallback, useState } from 'react';
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
  type PhysicalCountRow, type ExistingProduct, type MasterProduct, PHYSICAL_COLUMN_ALIASES,
} from '@/lib/physicalCountUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePersistedFormState } from '@/hooks/usePersistedFormState';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'done';


export default function PhysicalCountModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  // Wizard state persistido en sessionStorage. Si el usuario está subiendo
  // el conteo y se sale / cambia de pestaña / se refresca, al volver el
  // wizard sigue donde estaba (paso, mapeo, filas cruzadas). El File no se
  // persiste pero ya tenemos rawRows parseado, así que no se necesita.
  type WizardState = {
    step: Step;
    headers: string[];
    rawRows: unknown[][];
    mapping: PhysicalColumnMapping[];
    rows: PhysicalCountRow[];
    result: { updated: number; notFound: number; errors: number };
  };
  const INITIAL: WizardState = {
    step: 'upload',
    headers: [],
    rawRows: [],
    mapping: [],
    rows: [],
    result: { updated: 0, notFound: 0, errors: 0 },
  };
  const [wizard, setWizard, clearWizard] = usePersistedFormState<WizardState>(
    'inventario:conteo-fisico:v1',
    INITIAL,
  );
  const step = wizard.step;
  const setStep = (s: Step) => setWizard((w) => ({ ...w, step: s }));
  const headers = wizard.headers;
  const setHeaders = (h: string[]) => setWizard((w) => ({ ...w, headers: h }));
  const rawRows = wizard.rawRows;
  const setRawRows = (r: unknown[][]) => setWizard((w) => ({ ...w, rawRows: r }));
  const mapping = wizard.mapping;
  const setMapping = (m: PhysicalColumnMapping[] | ((prev: PhysicalColumnMapping[]) => PhysicalColumnMapping[])) =>
    setWizard((w) => ({ ...w, mapping: typeof m === 'function' ? m(w.mapping) : m }));
  const rows = wizard.rows;
  const setRows = (r: PhysicalCountRow[]) => setWizard((w) => ({ ...w, rows: r }));
  const result = wizard.result;
  const setResult = (r: { updated: number; notFound: number; errors: number }) =>
    setWizard((w) => ({ ...w, result: r }));
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setWizard(INITIAL);
    clearWizard();
    setUploading(false);
  };

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
      toast({ title: 'Formato no soportado', description: 'Solo se aceptan archivos Excel (.xlsx)', variant: 'destructive' });
      return;
    }
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string) as any;
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (jsonRows.length < 2) {
        toast({ title: 'Archivo vacío', variant: 'destructive' });
        return;
      }
      const detectedHeaders = (jsonRows[0] as unknown[]).map((c: unknown) => String(c ?? ''));
      let dataRows = jsonRows.slice(1) as unknown[][];
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
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
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

    // Fetch existing products (inventario contable Siigo)
    const { data: existing } = await supabase
      .from('inventory_products')
      .select('id, reference, stock_system, name')
      .eq('active', true);

    // Fetch maestro para traducir referencias por color (-2/-3/-0/sin sufijo)
    // a la ref_siigo (-5) del inventario contable. Sin esto, un conteo por
    // color nunca matchea el código colorless de Siigo.
    const { data: master } = await (supabase as any)
      .from('product_master')
      .select('ref_siigo, ref_local, ref_proveedor_a, ref_proveedor_b, ref_proveedor_c')
      .eq('active', true);

    const crossed = crossReferenceWithInventory(
      withDups,
      (existing || []) as ExistingProduct[],
      (master || []) as MasterProduct[],
    );
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
          .eq('id', r.existingProductId!);
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

  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string) as any;

      // Pre-cargar la plantilla con TODAS las referencias que ya existen en
      // el inventario contable. Así el bodeguero no tiene que tipear las
      // referencias (que pueden tener formato específico, ej: el "-5" que
      // agregaron en Siigo) — solo completa la columna unidades_fisicas.
      // Esto evita el problema de "referencia no existe" por typos o por
      // formato distinto al del sistema.
      const { data: existing } = await supabase
        .from('inventory_products')
        .select('reference, name, unit')
        .eq('active', true)
        .order('reference');

      const header = ['referencia', 'nombre_producto', 'unidad_medida', 'unidades_fisicas'];
      const data: (string | number)[][] = [header];

      if (existing && existing.length > 0) {
        for (const p of existing) {
          // unidades_fisicas vacío — lo llena el bodeguero
          data.push([p.reference ?? '', p.name ?? '', p.unit ?? 'unidad', '']);
        }
      } else {
        // Fallback: si el inventario está vacío, dejar ejemplos.
        data.push(['REF-001', 'Perfil T6 Natural', 'unidad', 148]);
        data.push(['REF-002', 'Lámina Lisa 1mm', 'metro', 82]);
      }

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 15 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Conteo Físico');
      XLSX.writeFile(wb, 'plantilla_inventario_fisico.xlsx');

      if (existing && existing.length > 0) {
        toast({
          title: 'Plantilla descargada',
          description: `${existing.length} referencias pre-cargadas. El bodeguero solo completa la columna "unidades_fisicas".`,
        });
      }
    } catch {
      toast({ title: 'Error al generar plantilla', variant: 'destructive' });
    } finally {
      setDownloadingTemplate(false);
    }
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
              <p className="text-xs text-muted-foreground mt-1">Archivo Excel (.xlsx) con referencia, nombre, unidad y unidades contadas</p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={downloadingTemplate} className="gap-2 w-full">
              <Download className="h-3.5 w-3.5" />
              {downloadingTemplate ? 'Generando plantilla…' : 'Descargar plantilla con tus referencias'}
            </Button>
            <div className="text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1">
              <p className="font-medium text-primary">📋 La plantilla ya trae tus referencias del sistema</p>
              <p>Descargás el Excel con todas las referencias precargadas — el bodeguero solo completa la columna <span className="font-mono">unidades_fisicas</span> con lo que cuenta en bodega. No tiene que tipear referencias.</p>
            </div>
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
                  <Select value={m.mappedTo || '__none'} onValueChange={(v) => handleMappingChange(idx, v === '__none' ? null : v as PhysicalField)}>
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

            {/* Lista COMPLETA — antes se cortaba a 30 filas. El contenedor
                scrollea, así que mostramos todo para que el usuario pueda
                revisar cada referencia. */}
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-border/50">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow className="text-xs">
                    <TableHead>Ref.</TableHead>
                    <TableHead className="text-right">Uds. Sistema</TableHead>
                    <TableHead className="text-right">Uds. Físicas</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
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
            </div>

            {/* Alerta cuando hay MUCHAS referencias no identificadas — eso
                típicamente significa que el maestro de productos está
                desactualizado (ej: cambió el formato de referencia en Siigo
                pero no se re-sincronizó). */}
            {notFoundCount > 0 && (() => {
              const pct = rows.length > 0 ? (notFoundCount / rows.length) * 100 : 0;
              const isCritical = pct >= 30 || notFoundCount >= 15;
              return isCritical ? (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl p-3 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    {notFoundCount} de {rows.length} referencias ({Math.round(pct)}%) no existen en tu inventario
                  </p>
                  <p className="text-destructive/80">
                    El cruce ya traduce automáticamente los colores (-2 Blanco, -3 Negro, -0 Crudo) y el "-5" de
                    Siigo vía el maestro. Si aun así estas referencias no aparecen, es porque <strong>esos productos
                    no existen en tu inventario contable de Siigo</strong> — cargalos en Siigo (o por carga masiva
                    de inventario) y volvé a intentar el conteo.
                  </p>
                </div>
              ) : (
                <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                  <p className="font-medium">⚠️ {notFoundCount} referencias no existen en el inventario contable de Siigo</p>
                  <p className="text-muted-foreground mt-1">Estas referencias serán ignoradas. Primero cárgalas desde Siigo.</p>
                </div>
              );
            })()}

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
