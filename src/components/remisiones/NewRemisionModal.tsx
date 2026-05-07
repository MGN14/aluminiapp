import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileSpreadsheet, X, AlertCircle, ArrowUpCircle, ArrowDownCircle, PackagePlus, AlertTriangle, UserPlus } from 'lucide-react';
import {
  fetchProductsByRefs,
  createMissingProducts,
  applyRemisionInventory,
  type RemisionType,
  type RemisionItemInput,
  type ProductLite,
} from '@/lib/remisionInventory';
import { usePersistedFormState } from '@/hooks/usePersistedFormState';

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

const NEW_RESPONSIBLE_VALUE = '__new__';

export default function NewRemisionModal({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'form' | 'excel' | 'preview'>('form');
  // Persistencia de los campos del paso "form" — los items / headers / file
  // del paso Excel NO se persisten porque dependen de un File object
  // (no JSON-serializable). Si Nico llega al paso preview y cambia de
  // pestaña, vuelve y los datos del header/cliente siguen, solo tiene que
  // re-subir el archivo Excel.
  type FormState = {
    remisionType: RemisionType;
    date: string;
    responsibleId: string;
    beneficiary: string;
    notes: string;
    status: string;
  };
  const INITIAL_FORM: FormState = {
    remisionType: 'venta',
    date: new Date().toISOString().split('T')[0],
    responsibleId: '',
    beneficiary: '',
    notes: '',
    status: 'pendiente',
  };
  const [formPersist, setFormPersist, clearFormPersist] = usePersistedFormState<FormState>(
    'remisiones:nueva:v1',
    INITIAL_FORM,
  );
  const remisionType = formPersist.remisionType;
  const setRemisionType = (v: RemisionType) => setFormPersist((f) => ({ ...f, remisionType: v }));
  const date = formPersist.date;
  const setDate = (v: string) => setFormPersist((f) => ({ ...f, date: v }));
  const responsibleId = formPersist.responsibleId;
  const setResponsibleId = (v: string) => setFormPersist((f) => ({ ...f, responsibleId: v }));
  const beneficiary = formPersist.beneficiary;
  const setBeneficiary = (v: string) => setFormPersist((f) => ({ ...f, beneficiary: v }));
  const notes = formPersist.notes;
  const setNotes = (v: string) => setFormPersist((f) => ({ ...f, notes: v }));
  const status = formPersist.status;
  const setStatus = (v: string) => setFormPersist((f) => ({ ...f, status: v }));
  const [creatingResp, setCreatingResp] = useState(false);
  const [newRespName, setNewRespName] = useState('');
  const [fileName, setFileName] = useState('');
  const [items, setItems] = useState<RemisionItemInput[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [refCol, setRefCol] = useState('');
  const [nameCol, setNameCol] = useState('');
  const [unitsCol, setUnitsCol] = useState('');
  const [costCol, setCostCol] = useState('');
  const [totalRemision, setTotalRemision] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Inventory resolution (computed when entering preview)
  const [productMap, setProductMap] = useState<Map<string, ProductLite>>(new Map());
  const [unmatchedRefs, setUnmatchedRefs] = useState<RemisionItemInput[]>([]);
  const [resolving, setResolving] = useState(false);

  // Confirmation modal for auto-creating products on 'compra'
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);

  // Responsibles del usuario (para dropdown). Filtramos por banking + both
  // (clientes/proveedores formales). Petty_cash es solo para Caja Menor.
  const { data: responsibles = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['responsibles-remisiones', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      // Sin .eq('user_id', user!.id): RLS ya filtra por current_data_owner(),
      // y para colaboradores user.id ≠ current_data_owner() — el filtro extra
      // les ocultaba todos los responsibles del owner.
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name, responsible_type')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return ((data ?? []) as unknown as Array<{ id: string; name: string; responsible_type: string }>)
        .filter((r) => r.responsible_type === 'banking' || r.responsible_type === 'both' || !r.responsible_type)
        .map((r) => ({ id: r.id, name: r.name }));
    },
  });

  const handleResponsibleChange = (value: string) => {
    if (value === NEW_RESPONSIBLE_VALUE) {
      setCreatingResp(true);
      setResponsibleId('');
      setBeneficiary('');
    } else {
      setResponsibleId(value);
      setCreatingResp(false);
      const resp = responsibles.find((r) => r.id === value);
      setBeneficiary(resp?.name ?? '');
    }
  };

  const handleCreateResponsible = async () => {
    if (!user) return;
    const name = newRespName.trim();
    if (!name) {
      toast({ title: 'Falta nombre', variant: 'destructive' });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('responsibles')
        .insert({ user_id: user.id, name, responsible_type: 'banking' } as never)
        .select('id, name')
        .single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['responsibles-remisiones'] });
      setResponsibleId(data!.id);
      setBeneficiary(data!.name);
      setCreatingResp(false);
      setNewRespName('');
      toast({ title: 'Cliente/proveedor creado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const reset = () => {
    setStep('form');
    setFormPersist(INITIAL_FORM);
    clearFormPersist();
    setCreatingResp(false);
    setNewRespName('');
    setFileName('');
    setItems([]);
    setHeaders([]);
    setRawRows([]);
    setRefCol('');
    setNameCol('');
    setUnitsCol('');
    setCostCol('');
    setTotalRemision('');
    setSaving(false);
    setProductMap(new Map());
    setUnmatchedRefs([]);
    setConfirmCreateOpen(false);
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
        const allRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
        if (allRows.length < 2) {
          toast({ title: 'Archivo vacío', description: 'El archivo no tiene datos suficientes.', variant: 'destructive' });
          return;
        }

        let headerRowIdx = 0;
        for (let i = 0; i < Math.min(allRows.length, 10); i++) {
          const nonEmpty = allRows[i].filter(c => String(c).trim() !== '').length;
          if (nonEmpty >= 3) { headerRowIdx = i; break; }
        }

        const rawHdrs = allRows[headerRowIdx].map(String);
        const allDataRows = allRows.slice(headerRowIdx + 1).filter(r => r.some(c => String(c).trim() !== ''));
        const totalDataRows = allDataRows.length || 1;

        const colIndices: number[] = [];
        const hdrs: string[] = [];
        rawHdrs.forEach((h, idx) => {
          const filled = allDataRows.filter(r => String(r[idx] || '').trim() !== '').length;
          const hasHeader = h.trim() !== '';
          if (hasHeader || filled / totalDataRows >= 0.3) {
            colIndices.push(idx);
            hdrs.push(h.trim() || `Col ${idx + 1}`);
          }
        });

        const dataRows = allDataRows.map(r => colIndices.map(i => String(r[i] || '')));
        setHeaders(hdrs);
        setRawRows(dataRows);

        const lower = hdrs.map(h => h.toLowerCase());
        setRefCol(hdrs[lower.findIndex(h => h.includes('ref') || h.includes('cod'))] || hdrs[0] || '');
        setNameCol(hdrs[lower.findIndex(h => h.includes('descrip') || h.includes('nombre') || h.includes('product'))] || hdrs[1] || '');
        setUnitsCol(hdrs[lower.findIndex(h => h.includes('und') || h.includes('uni') || h.includes('cant') || h.includes('qty'))] || '');
        setCostCol(hdrs[lower.findIndex(h => h.includes('precio') || h.includes('costo') || h.includes('valor') || h.includes('price'))] || '');
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

  const buildPreview = async () => {
    if (!refCol || !unitsCol) {
      toast({ title: 'Seleccioná al menos Referencia y Unidades', variant: 'destructive' });
      return;
    }
    const refIdx = headers.indexOf(refCol);
    const nameIdx = nameCol ? headers.indexOf(nameCol) : -1;
    const unitsIdx = headers.indexOf(unitsCol);
    const costIdx = costCol ? headers.indexOf(costCol) : -1;

    const parsed: RemisionItemInput[] = rawRows
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

    // Resolve against inventory maestro
    if (user?.id) {
      setResolving(true);
      try {
        const map = await fetchProductsByRefs(user.id, parsed.map(i => i.reference));
        setProductMap(map);
        const unmatched = parsed.filter(i => !map.has(i.reference.trim().toLowerCase()));
        setUnmatchedRefs(unmatched);
      } catch (e) {
        toast({ title: 'Error al cruzar con el maestro de productos', variant: 'destructive' });
      } finally {
        setResolving(false);
      }
    }
    setStep('preview');
  };

  const doSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      // For compra: create missing products first so they exist in productMap.
      let finalProductMap = productMap;
      if (remisionType === 'compra' && unmatchedRefs.length > 0) {
        const toCreate = unmatchedRefs.map(i => ({
          reference: i.reference,
          name: i.product_name,
          unit_cost: i.unit_cost,
        }));
        const created = await createMissingProducts(user.id, toCreate);
        finalProductMap = new Map(productMap);
        created.forEach((v, k) => finalProductMap.set(k, v));
      }

      // El numero consecutivo lo asigna el trigger SQL (anti race-condition).
      // Las remisiones SIEMPRE se crean en DIAN, sin importar el modo activo.
      // Los colaboradores no tienen acceso a Gerencial, asi que el flujo es:
      // siempre crear en DIAN y el admin decide despues si la mueve a Gerencial.
      const moduleOriginVal = 'dian';

      const { data: remision, error: remError } = await (supabase
        .from('remisiones') as any)
        .insert({
          user_id: user.id,
          date,
          // number: omitido — el trigger BEFORE INSERT lo asigna
          beneficiary,
          responsible_id: responsibleId || null,
          notes,
          status,
          total_manual: totalRemision ? parseFloat(totalRemision) : null,
          module_origin: moduleOriginVal,
          remision_type: remisionType,
        })
        .select('id, number')
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

      // Apply inventory side effects
      const result = await applyRemisionInventory({
        userId: user.id,
        remisionId: remision.id,
        remisionType,
        movementDate: date,
        items,
        productMap: finalProductMap,
      });

      const typeLabel = remisionType === 'compra' ? 'Compra' : 'Venta';
      let description = `${items.length} referencias guardadas.`;
      if (result.applied > 0) {
        const action = remisionType === 'compra' ? 'sumados' : 'descontados';
        description += ` ${result.applied} ítems ${action} del inventario físico.`;
      }
      if (result.unmatched.length > 0 && remisionType === 'venta') {
        description += ` ⚠️ ${result.unmatched.length} ítems sin match en maestro (no afectaron stock).`;
      }

      toast({
        title: `Remisión ${typeLabel} ${remision.number ?? ''} creada`,
        description,
      });
      onComplete();
      handleClose();
    } catch (e: any) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setConfirmCreateOpen(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    if (!beneficiary.trim() && !responsibleId) {
      toast({ title: remisionType === 'compra' ? 'El proveedor es requerido' : 'El beneficiario es requerido', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'No hay items para guardar', variant: 'destructive' });
      return;
    }

    // For compra with new products, ask confirmation before creating them.
    if (remisionType === 'compra' && unmatchedRefs.length > 0) {
      setConfirmCreateOpen(true);
      return;
    }
    await doSave();
  };

  const totalUnidades = items.reduce((s, i) => s + i.units, 0);
  const totalValor = items.reduce((s, i) => s + i.units * i.unit_cost, 0);

  const isCompra = remisionType === 'compra';
  const beneficiaryLabel = isCompra ? 'Proveedor *' : 'Beneficiario *';
  const beneficiaryHint = isCompra
    ? '(a quién le compraste)'
    : '(cliente, área o persona que recibe)';
  const beneficiaryPlaceholder = isCompra
    ? 'Ej: Aluminios S.A., Perfilería del Valle...'
    : 'Ej: Ferromendez, Área de producción, Juan Pérez...';

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva Remisión</DialogTitle>
          </DialogHeader>

          {/* Tipo: Venta vs Compra */}
          {step === 'form' && (
            <div className="space-y-2 pb-2 border-b">
              <Label>Tipo de remisión *</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRemisionType('venta')}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                    remisionType === 'venta'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30'
                  }`}
                >
                  <ArrowUpCircle className={`h-5 w-5 mt-0.5 ${remisionType === 'venta' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-semibold">Venta / Salida</div>
                    <div className="text-xs text-muted-foreground">Despacho a cliente — resta del inventario físico</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRemisionType('compra')}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                    remisionType === 'compra'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30'
                  }`}
                >
                  <ArrowDownCircle className={`h-5 w-5 mt-0.5 ${remisionType === 'compra' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-semibold">Compra / Entrada</div>
                    <div className="text-xs text-muted-foreground">Recepción de proveedor — suma al inventario físico</div>
                  </div>
                </button>
              </div>
            </div>
          )}

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
                    <SelectItem value="despachado">{isCompra ? 'Recibido' : 'Despachado'}</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>{beneficiaryLabel} <span className="text-xs text-muted-foreground">{beneficiaryHint}</span></Label>
                {creatingResp ? (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      placeholder={beneficiaryPlaceholder}
                      value={newRespName}
                      onChange={(e) => setNewRespName(e.target.value)}
                    />
                    <Button type="button" size="sm" onClick={handleCreateResponsible}>Crear</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setCreatingResp(false); setNewRespName(''); }}>Cancelar</Button>
                  </div>
                ) : (
                  <Select value={responsibleId} onValueChange={handleResponsibleChange}>
                    <SelectTrigger>
                      <SelectValue placeholder={responsibles.length === 0 ? 'Crear nuevo' : 'Seleccionar...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {responsibles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                      <SelectItem value={NEW_RESPONSIBLE_VALUE} className="text-primary">
                        <span className="inline-flex items-center gap-1.5">
                          <UserPlus className="h-3.5 w-3.5" />
                          Crear nuevo
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Misma lista que Conciliación bancaria. Vincula la remisión al cliente/proveedor real.
                </p>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Total de la remisión <span className="text-xs text-muted-foreground">(opcional)</span></Label>
                <Input type="number" placeholder="Ej: 5000000" value={totalRemision} onChange={e => setTotalRemision(e.target.value)} />
              </div>
              <div className="space-y-2">
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
                  { label: isCompra ? 'Costo unitario *' : 'Costo unitario', value: costCol, set: setCostCol },
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
                  Completá el campo {isCompra ? 'Proveedor' : 'Beneficiario'} antes de guardar.
                </div>
              )}

              {/* Resolución con maestro de productos */}
              {resolving ? (
                <div className="text-xs text-muted-foreground">Cruzando con el maestro de productos…</div>
              ) : (
                <>
                  {isCompra && unmatchedRefs.length > 0 && (
                    <div className="flex items-start gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <PackagePlus className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
                      <div>
                        <p className="font-medium text-blue-900">
                          {unmatchedRefs.length} productos nuevos se crearán en tu maestro
                        </p>
                        <p className="text-xs text-blue-700 mt-0.5">
                          Quedarán registrados con el nombre y costo de este Excel. Te pediremos confirmación antes de guardar.
                        </p>
                      </div>
                    </div>
                  )}
                  {!isCompra && unmatchedRefs.length > 0 && (
                    <div className="flex items-start gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-600" />
                      <div>
                        <p className="font-medium text-yellow-900">
                          {unmatchedRefs.length} referencias no están en tu maestro
                        </p>
                        <p className="text-xs text-yellow-700 mt-0.5">
                          Estos ítems se guardarán en la remisión pero <strong>no afectarán el stock físico</strong>. Creá los productos en Inventario si querés que se descuenten.
                        </p>
                      </div>
                    </div>
                  )}
                  {productMap.size > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {items.length - unmatchedRefs.length} de {items.length} ítems coinciden con tu maestro.
                    </div>
                  )}
                </>
              )}

              <div className="rounded-lg border overflow-x-auto max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead>Maestro</TableHead>
                      <TableHead className="text-right">Unidades</TableHead>
                      <TableHead className="text-right">Costo unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, i) => {
                      const matched = productMap.has(item.reference.trim().toLowerCase());
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                          <TableCell className="text-xs">{item.product_name}</TableCell>
                          <TableCell className="text-xs">
                            {matched ? (
                              <span className="text-green-600">✓ En maestro</span>
                            ) : isCompra ? (
                              <span className="text-blue-600">+ Nuevo</span>
                            ) : (
                              <span className="text-yellow-600">— Sin match</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{item.units.toLocaleString('es-CO')}</TableCell>
                          <TableCell className="text-right">{item.unit_cost > 0 ? formatCurrency(item.unit_cost) : '—'}</TableCell>
                          <TableCell className="text-right">{item.unit_cost > 0 ? formatCurrency(item.units * item.unit_cost) : '—'}</TableCell>
                        </TableRow>
                      );
                    })}
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
                  {saving ? 'Guardando...' : `Guardar Remisión de ${isCompra ? 'Compra' : 'Venta'}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmación: crear productos nuevos en el maestro */}
      <Dialog open={confirmCreateOpen} onOpenChange={(o) => { if (!o && !saving) setConfirmCreateOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear productos nuevos en tu maestro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Estos productos no existen aún en tu maestro. Se crearán automáticamente con los datos de la remisión de compra:
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref.</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmatchedRefs.map((i, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{i.reference}</TableCell>
                      <TableCell className="text-xs">{i.product_name}</TableCell>
                      <TableCell className="text-right text-xs">{i.unit_cost > 0 ? formatCurrency(i.unit_cost) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Podrás editarlos después en el Maestro de Productos.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCreateOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={doSave} disabled={saving}>
              {saving ? 'Creando…' : `Crear ${unmatchedRefs.length} productos y guardar`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
