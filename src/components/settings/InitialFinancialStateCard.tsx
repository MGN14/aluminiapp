import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  useInitialFinancialState,
  getTotalActivos,
  getTotalPasivos,
  getPatrimonio,
  type InitialStateFormData,
  type InitialStateDetail,
  type SaveStatus,
} from '@/hooks/useInitialFinancialState';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2,
  Landmark,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  DollarSign,
  CreditCard,
  Receipt,
  Plus,
  Trash2,
  Info,
  Cloud,
  CloudOff,
} from 'lucide-react';

const DEFAULT_FORM: InitialStateFormData = {
  fecha_inicio: new Date().toISOString().slice(0, 10),
  saldo_bancos: 0,
  inventario: 0,
  otros_activos: 0,
  impuestos_por_pagar: 0,
  prestamos: 0,
  iva_a_favor: 0,
};

type DetailFieldType = InitialStateDetail['field_type'];

const FIELD_TYPE_LABELS: Record<DetailFieldType, string> = {
  cuentas_por_cobrar: 'Lo que me deben',
  anticipos_a_proveedores: 'Anticipos a proveedores',
  anticipos_de_clientes: 'Anticipos de clientes',
  cuentas_por_pagar: 'Lo que debo',
};

interface Responsible {
  id: string;
  name: string;
}

function CurrencyInput({
  id, label, value, onChange, disabled,
}: { id: string; label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          id={id} type="number" min={0} step="0.01"
          value={value || ''} onChange={(e) => onChange(Number(e.target.value) || 0)}
          disabled={disabled} className="pl-7 text-right" placeholder="0"
        />
      </div>
    </div>
  );
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Guardando...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Cloud className="h-3 w-3 text-emerald-500" />
          <span className="text-emerald-600">Guardado</span>
        </>
      )}
      {status === 'error' && (
        <>
          <CloudOff className="h-3 w-3 text-destructive" />
          <span className="text-destructive">Error al guardar</span>
        </>
      )}
    </div>
  );
}

function DetailSection({
  fieldType, label, items, globalDetails, onAdd, onRemove, onUpdate, disabled, responsibles,
}: {
  fieldType: DetailFieldType;
  label: string;
  items: InitialStateDetail[];
  globalDetails: InitialStateDetail[];
  onAdd: () => void;
  onRemove: (globalIndex: number) => void;
  onUpdate: (globalIndex: number, field: 'responsible_name' | 'amount', value: string | number) => void;
  disabled: boolean;
  responsibles: Responsible[];
}) {
  const total = items.reduce((s, i) => s + i.amount, 0);

  // Build a map from local index to global index
  const globalIndices: number[] = [];
  globalDetails.forEach((d, gi) => {
    if (d.field_type === fieldType) globalIndices.push(gi);
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs font-medium text-muted-foreground">{formatCurrency(total)}</span>
      </div>
      {items.map((item, localIdx) => {
        const gi = globalIndices[localIdx];
        return (
          <div key={`${fieldType}-${localIdx}`} className="flex items-center gap-2">
            <Input
              value={item.responsible_name}
              onChange={(e) => onUpdate(gi, 'responsible_name', e.target.value)}
              disabled={disabled}
              placeholder="Nombre del tercero"
              className="flex-1 text-sm"
              list={`resp-list-${fieldType}`}
            />
            <div className="relative w-36">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                type="number" min={0} step="0.01"
                value={item.amount || ''}
                onChange={(e) => onUpdate(gi, 'amount', Number(e.target.value) || 0)}
                disabled={disabled}
                className="pl-6 text-right text-sm"
                placeholder="0"
              />
            </div>
            {!disabled && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onRemove(gi)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
      <datalist id={`resp-list-${fieldType}`}>
        {responsibles.map(r => <option key={r.id} value={r.name} />)}
      </datalist>
      {!disabled && (
        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onAdd}>
          <Plus className="h-3 w-3 mr-1" />
          Agregar
        </Button>
      )}
    </div>
  );
}

export default function InitialFinancialStateCard() {
  const { initialData, initialDetails, loading, isConfigured, save, autoSave, saveStatus } = useInitialFinancialState();
  const { user } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState<InitialStateFormData>(DEFAULT_FORM);
  const [details, setDetails] = useState<InitialStateDetail[]>([]);
  const [editing, setEditing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const hasLoadedRef = useRef(false);

  const isReadOnly = isConfigured && !editing;

  // Load responsibles once
  useEffect(() => {
    if (!user) return;
    supabase.from('responsibles').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setResponsibles((data as Responsible[]) || []));
  }, [user]);

  // Initialize form from DB only on first load (not on every save)
  useEffect(() => {
    if (hasLoadedRef.current) return;
    if (loading) return;

    if (initialData) {
      setForm({
        fecha_inicio: initialData.fecha_inicio,
        saldo_bancos: initialData.saldo_bancos,
        inventario: initialData.inventario,
        otros_activos: initialData.otros_activos,
        impuestos_por_pagar: initialData.impuestos_por_pagar,
        prestamos: initialData.prestamos,
        iva_a_favor: initialData.iva_a_favor,
      });
    }
    setDetails(initialDetails.map(d => ({ ...d })));
    hasLoadedRef.current = true;
  }, [loading, initialData, initialDetails]);

  const triggerAutoSave = useCallback((newForm: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (isReadOnly) return;
    if (!newForm.fecha_inicio) return;
    autoSave(newForm, newDetails);
  }, [autoSave, isReadOnly]);

  const updateField = useCallback((field: keyof InitialStateFormData, value: number | string) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Use setTimeout to avoid setState-during-render
      setTimeout(() => triggerAutoSave(next, details), 0);
      return next;
    });
  }, [triggerAutoSave, details]);

  const addDetail = useCallback((fieldType: DetailFieldType) => {
    setDetails(prev => [...prev, { field_type: fieldType, responsible_id: null, responsible_name: '', amount: 0 }]);
  }, []);

  const removeDetail = useCallback((globalIndex: number) => {
    setDetails(prev => {
      const next = prev.filter((_, i) => i !== globalIndex);
      setTimeout(() => triggerAutoSave(form, next), 0);
      return next;
    });
  }, [form, triggerAutoSave]);

  const updateDetail = useCallback((globalIndex: number, field: 'responsible_name' | 'amount', value: string | number) => {
    setDetails(prev => {
      const next = prev.map((d, i) => {
        if (i !== globalIndex) return d;
        const updated = { ...d, [field]: value };
        if (field === 'responsible_name') {
          const match = responsibles.find(r => r.name.toLowerCase() === (value as string).toLowerCase());
          updated.responsible_id = match?.id || null;
        }
        return updated;
      });
      setTimeout(() => triggerAutoSave(form, next), 0);
      return next;
    });
  }, [form, responsibles, triggerAutoSave]);

  const getItemsForType = useCallback((type: DetailFieldType) => details.filter(d => d.field_type === type), [details]);

  const totalActivos = useMemo(() => getTotalActivos(form, details), [form, details]);
  const totalPasivos = useMemo(() => getTotalPasivos(form, details), [form, details]);
  const patrimonio = useMemo(() => getPatrimonio(form, details), [form, details]);
  const isBalanced = Math.abs(totalActivos - (totalPasivos + patrimonio)) < 0.01;

  const handleSave = async () => {
    if (isReadOnly) return;
    if (isConfigured && editing) {
      setShowConfirm(true);
      return;
    }
    await doSave();
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await save(form, details);
      setEditing(false);
      toast({ title: 'Estado inicial guardado', description: 'Los saldos iniciales se han actualizado correctamente.' });
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Error', description: 'No se pudo guardar el estado inicial.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = useCallback(() => {
    setEditing(false);
    if (initialData) {
      setForm({
        fecha_inicio: initialData.fecha_inicio,
        saldo_bancos: initialData.saldo_bancos,
        inventario: initialData.inventario,
        otros_activos: initialData.otros_activos,
        impuestos_por_pagar: initialData.impuestos_por_pagar,
        prestamos: initialData.prestamos,
        iva_a_favor: initialData.iva_a_favor,
      });
    }
    setDetails(initialDetails.map(d => ({ ...d })));
  }, [initialData, initialDetails]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Landmark className="h-5 w-5 text-muted-foreground" />
                Estado inicial financiero
              </CardTitle>
              <CardDescription>
                {isConfigured
                  ? 'Saldos con los que comenzaste a usar AluminIA. Estos son el punto de partida de tus reportes.'
                  : 'Configura el punto de partida financiero de tu negocio. Usa los valores declarados en tus estados financieros o balance del contador.'}
              </CardDescription>
            </div>
            {!isReadOnly && <SaveStatusBadge status={saveStatus} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Fecha inicio */}
          <div className="space-y-2">
            <Label htmlFor="fecha_inicio" className="font-medium">Fecha de inicio en AluminIA</Label>
            <Input
              id="fecha_inicio" type="date" value={form.fecha_inicio}
              onChange={(e) => updateField('fecha_inicio', e.target.value)}
              disabled={isReadOnly} className="w-48"
            />
            <p className="text-xs text-muted-foreground">
              Fecha desde la cual AluminIA empezará a calcular tu información financiera.
            </p>
          </div>

          <Separator />

          {/* Activos */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              <h3 className="font-medium text-sm">Activos</h3>
              <span className="ml-auto text-sm font-semibold text-emerald-600">{formatCurrency(totalActivos)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CurrencyInput id="saldo_bancos" label="Saldo en bancos" value={form.saldo_bancos} onChange={(v) => updateField('saldo_bancos', v)} disabled={isReadOnly} />
              <CurrencyInput id="inventario" label="Inventario" value={form.inventario} onChange={(v) => updateField('inventario', v)} disabled={isReadOnly} />
              <CurrencyInput id="otros_activos" label="Otros activos" value={form.otros_activos} onChange={(v) => updateField('otros_activos', v)} disabled={isReadOnly} />
            </div>
            <Separator className="my-2" />
            <DetailSection
              fieldType="cuentas_por_cobrar" label="Lo que me deben (por tercero)"
              items={getItemsForType('cuentas_por_cobrar')}
              globalDetails={details}
              onAdd={() => addDetail('cuentas_por_cobrar')}
              onRemove={removeDetail}
              onUpdate={updateDetail}
              disabled={isReadOnly} responsibles={responsibles}
            />
            <DetailSection
              fieldType="anticipos_a_proveedores" label="Anticipos a proveedores (por tercero)"
              items={getItemsForType('anticipos_a_proveedores')}
              globalDetails={details}
              onAdd={() => addDetail('anticipos_a_proveedores')}
              onRemove={removeDetail}
              onUpdate={updateDetail}
              disabled={isReadOnly} responsibles={responsibles}
            />
          </div>

          <Separator />

          {/* Pasivos */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-red-500" />
              <h3 className="font-medium text-sm">Deudas</h3>
              <span className="ml-auto text-sm font-semibold text-red-600">{formatCurrency(totalPasivos)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CurrencyInput id="impuestos_por_pagar" label="Impuestos por pagar" value={form.impuestos_por_pagar} onChange={(v) => updateField('impuestos_por_pagar', v)} disabled={isReadOnly} />
              <CurrencyInput id="prestamos" label="Préstamos" value={form.prestamos} onChange={(v) => updateField('prestamos', v)} disabled={isReadOnly} />
            </div>
            <Separator className="my-2" />
            <DetailSection
              fieldType="cuentas_por_pagar" label="Lo que debo (por tercero)"
              items={getItemsForType('cuentas_por_pagar')}
              globalDetails={details}
              onAdd={() => addDetail('cuentas_por_pagar')}
              onRemove={removeDetail}
              onUpdate={updateDetail}
              disabled={isReadOnly} responsibles={responsibles}
            />
            <DetailSection
              fieldType="anticipos_de_clientes" label="Anticipos de clientes (por tercero)"
              items={getItemsForType('anticipos_de_clientes')}
              globalDetails={details}
              onAdd={() => addDetail('anticipos_de_clientes')}
              onRemove={removeDetail}
              onUpdate={updateDetail}
              disabled={isReadOnly} responsibles={responsibles}
            />
          </div>

          <Separator />

          {/* Impuestos */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-500" />
              <h3 className="font-medium text-sm">Impuestos</h3>
            </div>
            <CurrencyInput id="iva_a_favor" label="IVA a favor" value={form.iva_a_favor} onChange={(v) => updateField('iva_a_favor', v)} disabled={isReadOnly} />
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Si pagas IVA (en contra), tu saldo es $0 al iniciar el año. Lo mismo aplica para Retefuente y ReteICA: al comenzar un nuevo año estos impuestos ya están pagos, por eso solo se registra el IVA a favor si existe.
              </p>
            </div>
          </div>

          <Separator />

          {/* Resumen */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Total Activos</span>
              <span className="font-semibold text-emerald-600">{formatCurrency(totalActivos)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Total Deudas</span>
              <span className="font-semibold text-red-600">{formatCurrency(totalPasivos)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm font-medium">
              <span>Lo que es tuyo de verdad (Activos − Deudas)</span>
              <span className={patrimonio >= 0 ? 'text-emerald-600' : 'text-red-600'}>{formatCurrency(patrimonio)}</span>
            </div>
            {isBalanced && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 mt-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ecuación contable equilibrada
              </div>
            )}
          </div>

          {!isBalanced && totalActivos > 0 && totalPasivos > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                La ecuación contable no está equilibrada. Verifica que los montos sean correctos.
              </AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {isConfigured && !editing ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar estado inicial
              </Button>
            ) : (
              <>
                {editing && (
                  <Button variant="ghost" onClick={handleCancel}>
                    Cancelar
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Modificar estado inicial?</AlertDialogTitle>
            <AlertDialogDescription>
              Cambiar los saldos iniciales afectará todos los cálculos, reportes y el score financiero. ¿Estás seguro?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowConfirm(false); doSave(); }}>
              Confirmar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
