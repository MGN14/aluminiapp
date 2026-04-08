import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  detectColumnMapping, buildProducts, markDuplicates, resolveDuplicates,
  type ColumnMapping, type MappedField, type ParsedProduct, type ImportMode, type DuplicateAction,
} from '@/lib/bulkUploadUtils';
import StepUpload from './bulk/StepUpload';
import StepMapping from './bulk/StepMapping';
import StepPreview from './bulk/StepPreview';
import StepResult from './bulk/StepResult';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'done';

// ── CSV parser ──
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

export default function BulkUploadModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [products, setProducts] = useState<ParsedProduct[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>('initial');
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>('sum');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState({ inserted: 0, errors: 0 });
  const [errorProducts, setErrorProducts] = useState<ParsedProduct[]>([]);
  const [hasExistingProducts, setHasExistingProducts] = useState(false);

  const reset = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setRawRows([]);
    setMapping([]);
    setProducts([]);
    setImportMode('initial');
    setDuplicateAction('sum');
    setUploading(false);
    setResult({ inserted: 0, errors: 0 });
    setErrorProducts([]);
  };

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    const isCSV = file.name.toLowerCase().endsWith('.csv');

    try {
      let detectedHeaders: string[];
      let dataRows: unknown[][];

      if (isCSV) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          toast({ title: 'Archivo vacío', description: 'El archivo no contiene datos.', variant: 'destructive' });
          return;
        }
        detectedHeaders = parseCSVLine(lines[0]);
        dataRows = lines.slice(1).map(l => parseCSVLine(l));
      } else {
        const rows = (await readXlsxFile(file)) as unknown as unknown[][];
        if (rows.length < 2) {
          toast({ title: 'Archivo vacío', description: 'El archivo no contiene datos.', variant: 'destructive' });
          return;
        }
        detectedHeaders = (rows[0] as unknown[]).map((c: unknown) => String(c ?? ''));
        dataRows = rows.slice(1) as unknown[][];
      }

      // Filter out completely empty rows
      dataRows = dataRows.filter(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''));

      setHeaders(detectedHeaders);
      setRawRows(dataRows);

      const autoMapping = detectColumnMapping(detectedHeaders);
      setMapping(autoMapping);

      // Check if user has existing products
      if (user) {
        const { count } = await supabase.from('inventory_products').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        setHasExistingProducts((count ?? 0) > 0);
      }

      setStep('mapping');
    } catch (err) {
      toast({ title: 'Error al leer archivo', description: 'No se pudo interpretar el archivo. Verifica el formato.', variant: 'destructive' });
    }
  }, [toast, user]);

  const handleMappingChange = (idx: number, field: MappedField | null) => {
    setMapping(prev => prev.map((m, i) => i === idx ? { ...m, mappedTo: field } : m));
  };

  const handleMappingConfirm = () => {
    const parsed = buildProducts(rawRows, mapping, 2);
    const withDuplicates = markDuplicates(parsed);
    setProducts(withDuplicates);
    setStep('preview');
  };

  const handleImport = async () => {
    if (!user) return;
    setUploading(true);

    // Resolve duplicates
    const hasDups = products.some(p => p.isDuplicate);
    const resolved = hasDups ? resolveDuplicates(products, duplicateAction) : products;
    const validProducts = resolved.filter(p => p.status !== 'error');
    const errorProds = resolved.filter(p => p.status === 'error');

    let inserted = 0;
    let errors = errorProds.length;

    try {
      // Handle import modes
      if (importMode === 'replace') {
        // Delete existing products first
        await supabase.from('inventory_products').delete().eq('user_id', user.id);
      }

      if (importMode === 'adjust') {
        // Fetch existing products to adjust
        const { data: existing } = await supabase.from('inventory_products').select('id, reference, stock_system').eq('user_id', user.id);
        const existingMap = new Map((existing || []).map(p => [p.reference.toLowerCase(), p]));

        for (let i = 0; i < validProducts.length; i += 50) {
          const batch = validProducts.slice(i, i + 50);
          const toUpdate: { id: string; stock_system: number }[] = [];
          const toInsert: typeof batch = [];

          for (const p of batch) {
            const ex = existingMap.get(p.referencia.toLowerCase());
            if (ex) {
              toUpdate.push({ id: ex.id, stock_system: ex.stock_system + p.stock });
            } else {
              toInsert.push(p);
            }
          }

          // Update existing
          for (const u of toUpdate) {
            const { error } = await supabase.from('inventory_products').update({ stock_system: u.stock_system }).eq('id', u.id);
            if (error) errors++;
            else inserted++;
          }

          // Insert new
          if (toInsert.length > 0) {
            const rows = toInsert.map(p => ({
              user_id: user.id,
              reference: p.referencia,
              name: p.nombre,
              unit: p.unidad,
              stock_system: p.stock,
              cost_per_unit: p.costo_unitario,
              sale_price: p.precio_venta,
              min_stock: p.stock_minimo,
            }));
            const { error } = await supabase.from('inventory_products').insert(rows);
            if (error) errors += rows.length;
            else inserted += rows.length;
          }
        }
      } else {
        // Initial or replace: insert all
        for (let i = 0; i < validProducts.length; i += 50) {
          const batch = validProducts.slice(i, i + 50).map(p => ({
            user_id: user.id,
            reference: p.referencia,
            name: p.nombre,
            unit: p.unidad,
            stock_system: p.stock,
            cost_per_unit: p.costo_unitario,
            sale_price: p.precio_venta,
            min_stock: p.stock_minimo,
          }));
          const { error } = await supabase.from('inventory_products').insert(batch);
          if (error) errors += batch.length;
          else inserted += batch.length;
        }
      }

      // Log import
      await supabase.from('inventory_import_logs').insert({
        user_id: user.id,
        file_name: fileName,
        rows_imported: inserted,
        rows_errors: errors,
        import_mode: importMode,
        error_details: errorProds.map(p => ({ row: p.rowNumber, ref: p.referencia, issues: p.issues })),
      });

    } catch (err) {
      console.error('Import error:', err);
    }

    setResult({ inserted, errors });
    setErrorProducts(errorProds);
    setStep('done');
    setUploading(false);
    if (inserted > 0) onComplete();
  };

  const hasDuplicates = products.some(p => p.isDuplicate);
  const sampleRows = rawRows.slice(0, 3);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Carga masiva de inventario'}
            {step === 'mapping' && 'Mapeo de columnas'}
            {step === 'preview' && 'Validación de datos'}
            {step === 'done' && 'Importación completada'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Sube un archivo Excel o CSV — compatible con Siigo'}
            {step === 'mapping' && 'Confirma que las columnas están correctamente asignadas'}
            {step === 'preview' && 'Revisa los datos antes de importar'}
            {step === 'done' && 'Resumen de la importación'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && <StepUpload onFileSelected={processFile} />}

        {step === 'mapping' && (
          <StepMapping
            mapping={mapping}
            sampleRows={sampleRows}
            fileName={fileName}
            totalRows={rawRows.length}
            onMappingChange={handleMappingChange}
            onConfirm={handleMappingConfirm}
            onBack={reset}
          />
        )}

        {step === 'preview' && (
          <StepPreview
            products={products}
            importMode={importMode}
            duplicateAction={duplicateAction}
            hasDuplicates={hasDuplicates}
            hasExistingProducts={hasExistingProducts}
            onImportModeChange={setImportMode}
            onDuplicateActionChange={setDuplicateAction}
            onConfirm={handleImport}
            onBack={() => setStep('mapping')}
            uploading={uploading}
          />
        )}

        {step === 'done' && (
          <StepResult
            inserted={result.inserted}
            errors={result.errors}
            errorProducts={errorProducts}
            onClose={() => { reset(); onOpenChange(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
