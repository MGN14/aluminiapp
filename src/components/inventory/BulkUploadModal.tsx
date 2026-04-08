import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ParsedRow {
  reference: string;
  name: string;
  unit: string;
  stock_system: number;
  cost_per_unit: number;
  sale_price: number;
  min_stock: number;
  valid: boolean;
  error?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

const EXPECTED_HEADERS = ['referencia', 'nombre', 'unidad', 'stock', 'costo_unitario', 'precio_venta', 'stock_minimo'];

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

function parseNumber(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$ ,]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function validateRow(row: ParsedRow): ParsedRow {
  const errors: string[] = [];
  if (!row.reference) errors.push('Sin referencia');
  if (!row.name) errors.push('Sin nombre');
  if (row.stock_system < 0) errors.push('Stock negativo');
  if (row.cost_per_unit < 0) errors.push('Costo negativo');
  return { ...row, valid: errors.length === 0, error: errors.join(', ') };
}

export default function BulkUploadModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState({ inserted: 0, errors: 0 });

  const reset = () => { setRows([]); setStep('upload'); setResult({ inserted: 0, errors: 0 }); };

  const processFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        toast({ title: 'Archivo vacío', description: 'El archivo no contiene datos.', variant: 'destructive' });
        return;
      }

      // Skip header
      const dataLines = lines.slice(1);
      const parsed: ParsedRow[] = dataLines.map(line => {
        const cols = parseCSVLine(line);
        return validateRow({
          reference: cols[0] || '',
          name: cols[1] || '',
          unit: cols[2] || 'unidad',
          stock_system: parseNumber(cols[3] || '0'),
          cost_per_unit: parseNumber(cols[4] || '0'),
          sale_price: parseNumber(cols[5] || '0'),
          min_stock: parseNumber(cols[6] || '0'),
          valid: true,
        });
      });

      setRows(parsed);
      setStep('preview');
    };
    reader.readAsText(file);
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => { if (files[0]) processFile(files[0]); },
    accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
    maxFiles: 1,
  });

  const handleUpload = async () => {
    if (!user) return;
    setUploading(true);
    const validRows = rows.filter(r => r.valid);
    let inserted = 0;
    let errors = 0;

    // Insert in batches of 50
    for (let i = 0; i < validRows.length; i += 50) {
      const batch = validRows.slice(i, i + 50).map(r => ({
        user_id: user.id,
        reference: r.reference,
        name: r.name,
        unit: r.unit,
        stock_system: r.stock_system,
        cost_per_unit: r.cost_per_unit,
        sale_price: r.sale_price,
        min_stock: r.min_stock,
      }));

      const { error } = await supabase.from('inventory_products').insert(batch);
      if (error) { errors += batch.length; }
      else { inserted += batch.length; }
    }

    errors += rows.filter(r => !r.valid).length;
    setResult({ inserted, errors });
    setStep('done');
    setUploading(false);
    if (inserted > 0) onComplete();
  };

  const downloadTemplate = () => {
    const csv = `referencia,nombre,unidad,stock,costo_unitario,precio_venta,stock_minimo\nREF-001,Perfil T6 Natural,metro,150,45000,72000,20\nREF-002,Lámina Lisa 1mm,unidad,80,38000,55000,10`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_inventario.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = rows.filter(r => r.valid).length;
  const invalidCount = rows.filter(r => !r.valid).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Carga masiva de productos</DialogTitle>
          <DialogDescription>Sube un archivo CSV con tus productos de inventario</DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                isDragActive ? 'border-success bg-success/5' : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium">Arrastra tu archivo CSV aquí</p>
              <p className="text-xs text-muted-foreground mt-1">o haz clic para seleccionar</p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2 w-full">
              <Download className="h-3.5 w-3.5" />
              Descargar plantilla CSV
            </Button>
            <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-xl p-3">
              <p className="font-medium">Formato esperado (columnas):</p>
              <p className="font-mono text-[10px]">{EXPECTED_HEADERS.join(', ')}</p>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{rows.length} productos encontrados</p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-success">{validCount} válidos</span>
                  {invalidCount > 0 && <span className="text-destructive ml-2">{invalidCount} con errores</span>}
                </p>
              </div>
            </div>

            <div className="max-h-64 overflow-auto rounded-xl border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Ref.</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 50).map((r, i) => (
                    <TableRow key={i} className={!r.valid ? 'bg-destructive/5' : ''}>
                      <TableCell className="font-mono text-xs">{r.reference || '—'}</TableCell>
                      <TableCell className="text-xs">{r.name || '—'}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{r.stock_system}</TableCell>
                      <TableCell className="text-right text-xs font-mono">${r.cost_per_unit.toLocaleString('es-CO')}</TableCell>
                      <TableCell>
                        {r.valid ? (
                          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">OK</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">{r.error}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 50 && <p className="text-xs text-muted-foreground text-center py-2">+{rows.length - 50} más...</p>}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={reset} className="flex-1">Cancelar</Button>
              <Button onClick={handleUpload} disabled={uploading || validCount === 0} className="flex-1 gap-2">
                {uploading ? 'Subiendo...' : `Importar ${validCount} productos`}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4 py-6">
            <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
            <div>
              <p className="text-lg font-semibold">{result.inserted} productos importados</p>
              {result.errors > 0 && (
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  {result.errors} no se pudieron importar
                </p>
              )}
            </div>
            <Button onClick={() => { reset(); onOpenChange(false); }} className="w-full">Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
