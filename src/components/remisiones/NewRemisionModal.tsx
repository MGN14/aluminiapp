import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileSpreadsheet, X, AlertCircle } from 'lucide-react';

interface RemisionItem {
  reference: string;
  product_name: string;
  units: number;
  unit_cost: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function NewRemisionModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<'form' | 'excel' | 'preview'>('form');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [beneficiary, setBeneficiary] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('pendiente');
  const [fileName, setFileName] = useState('');
  const [items, setItems] = useState<RemisionItem[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [refCol, setRefCol] = useState('');
  const [nameCol, setNameCol] = useState('');
  const [unitsCol, setUnitsCol] = useState('');
  const [costCol, setCostCol] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setStep('form');
    setDate(new Date().toISOString().split('T')[0]);
    setBeneficiary('');
    setNotes('');
    setStatus('pendiente');
    setFileName('');
    setItems([]);
    setHeaders([]);
    setRawRows([]);
    setRefCol('');
    setNameCol('');
    setUnitsCol('');
    setCostCol('');
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string) as any;
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
        if (rows.length < 2) {
          toast({ title: 'Archivo vacío', description: 'El archivo no tiene datos suficientes.', variant: 'destructive' });
          return;
        }
        const hdrs = rows[0].map(String);
        const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
        setHeaders(hdrs);
        setRawRows(dataRows.map(r => r.map(String)));
        // Auto-detect columns
        const lower = hdrs.map(h => h.toLowerCase());
        setRefCol(hdrs[lower.findIndex(h => h.includes('ref') || h.includes('cod'))] || hdrs[0] || '');
        setNameCol(hdrs[lower.findIndex(h => h.includes('nombre') || h.includes('product') || h.includes('descrip'))] || hdrs[1] || '');
        setUnitsCol(hdrs[lower.findIndex(h => h.includes('uni') || h.includes('cant') || h.includes('qty'))] || hdrs[2] || '');
        setCostCol(hdrs[lower.findIndex(h => h.includes('costo') || h.includes('precio') || h.includes('valor') || h.includes('price'))] || '');
        setStep('excel');
      } catch {
        toast({ title: 'Error al leer el archivo', variant: 'destructive' });
      }
    };
    reader.readAsArrayBuffer(file);
  }, [toast]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const buildPreview = () => {
    if (!refCol || !unitsCol) {
      toast({ title: 'Seleccioná al menos Referencia y Unidades', variant: 'destructive' });
      return;
    }
    const refIdx = headers.indexOf(refCol);
    const nameIdx = nameCol ? headers.indexOf(nameCol) : -1;
    const unitsIdx = headers.indexOf(unitsCol);
    const costIdx = costCol ? headers.indexOf(costCol) : -1;

    const parsed: RemisionItem[] = rawRows
      .map(row => ({
        reference: String(row[refIdx] || '').trim(),
        product_name: nameIdx >= 0 ? String(row[nameIdx] || '').trim() : String(row[refIdx] || '').trim(),
        units: parseFloat(String(row[unitsIdx] || '0').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0,
        unit_cost: costIdx >= 0 ? parseFloat(String(row[costIdx] || '0').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0 : 0,
      }))
      .filter(item => item.reference && item.units > 0);

    if (parsed.length === 0) {
      toast({ title: 'No se encontraron items válidos', variant: 'destructive' });
      return;
    }
    setItems(parsed);
    setStep('preview');
  };

  const handleSave = async () => {
    if (!user?.id) return;
    if (!beneficiary.trim()) {
      toast({ title: 'El beneficiario es requerido', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'No hay items para guardar', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Generate remision number
      const number = `REM-${Date.now().toString().slice(-6)}`;

      const { data: remision, error: remError } = await supabase
        .from('remisiones')
        .insert({ user_id: user.id, date, number, beneficiary, notes, status })
        .select('id')
        .single();

      if (remError) throw remError;

      const itemsToInsert = items.map(item => ({
        remision_id: remision.id,
        reference: item.reference,
        product_name: item.product_name,
        units: item.units,
        unit_cost: item.unit_cost,
      }));

      const { error: itemsError } = await supabase.from('remision_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      toast({ title: `Remisión ${number} creada`, description: `${items.length} referencias guardadas.` });
      onComplete();
      handleClose();
    } catch (e: any) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const totalUnidades = items.reduce((s, i) => s + i.units, 0);
  const totalValor = items.reduce((s, i) => s + i.units * i.unit_cost, 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Remisión</DialogTitle>
        </DialogHeader>

        {/* STEP 1: Datos generales */}
        {(step === 'form' || step === 'excel' || step === 'preview') && (
          <div className="grid grid-cols-2 gap-4 pb-4 border-b">
            <div className="space-y-2">
              <Label>Fecha *</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="despachado">Despachado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Beneficiario * <span className="text-xs text-muted-foreground">(cliente, área o persona que recibe)</span></Label>
              <Input
                placeholder="Ej: Ferromendez, Área de producción, Juan Pérez..."
                value={beneficiary}
                onChange={e => setBeneficiary(e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Notas <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Textarea placeholder="Observaciones adicionales..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {/* STEP 1b: Upload Excel */}
        {step === 'form' && (
          <div className="space-y-4">
            <Label>Cargar Excel con referencias y unidades *</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('remision-file-input')?.click()}
            >
              <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Arrastrá tu archivo Excel o CSV aquí</p>
              <p className="text-xs text-muted-foreground mt-1">Debe contener columnas de referencia y unidades</p>
              <Button variant="outline" size="sm" className="mt-3 gap-2">
                <Upload className="h-4 w-4" />
                Seleccionar archivo
              </Button>
              <input id="remision-file-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
            </div>
          </div>
        )}

        {/* STEP 2: Mapeo de columnas */}
        {step === 'excel' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{fileName} — {rawRows.length} filas detectadas</span>
              <Button variant="ghost" size="sm" onClick={() => setStep('form')} className="ml-auto gap-1">
                <X className="h-3 w-3" /> Cambiar archivo
              </Button>
            </div>
            <p className="text-sm font-medium">Mapeá las columnas del Excel:</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Referencia *', value: refCol, set: setRefCol },
                { label: 'Nombre del producto', value: nameCol, set: setNameCol },
                { label: 'Unidades *', value: unitsCol, set: setUnitsCol },
                { label: 'Costo unitario', value: costCol, set: setCostCol },
              ].map(({ label, value, set }) => (
                <div key={label} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Select value={value || '__none__'} onValueChange={(v) => set(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— No usar —</SelectItem>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {/* Preview rows */}
            <div className="rounded-lg border overflow-x-auto max-h-40">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map(h => <TableHead key={h} className="text-xs py-1">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawRows.slice(0, 3).map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => <TableCell key={j} className="text-xs py-1">{cell}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('form')}>Atrás</Button>
              <Button onClick={buildPreview}>Ver preview →</Button>
            </div>
          </div>
        )}

        {/* STEP 3: Preview y guardar */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{items.length} referencias listas para guardar</p>
              <Button variant="ghost" size="sm" onClick={() => setStep('excel')}>← Editar mapeo</Button>
            </div>

            {!beneficiary.trim() && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Completá el campo Beneficiario antes de guardar.
              </div>
            )}

            <div className="rounded-lg border overflow-x-auto max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Costo unit.</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                      <TableCell className="text-xs">{item.product_name}</TableCell>
                      <TableCell className="text-right">{item.units.toLocaleString('es-CO')}</TableCell>
                      <TableCell className="text-right">{item.unit_cost > 0 ? formatCurrency(item.unit_cost) : '—'}</TableCell>
                      <TableCell className="text-right">{item.unit_cost > 0 ? formatCurrency(item.units * item.unit_cost) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between items-center text-sm border-t pt-3">
              <span className="text-muted-foreground">Total unidades: <strong>{totalUnidades.toLocaleString('es-CO')}</strong></span>
              {totalValor > 0 && <span className="text-muted-foreground">Valor total: <strong>{formatCurrency(totalValor)}</strong></span>}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || !beneficiary.trim()}>
                {saving ? 'Guardando...' : 'Guardar Remisión'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
