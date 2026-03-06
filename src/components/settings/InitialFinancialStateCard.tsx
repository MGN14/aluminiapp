import { useState, useEffect, useMemo } from 'react';
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
  sumDetailsByType,
  type InitialStateFormData,
  type InitialStateDetail,
} from '@/hooks/useInitialFinancialState';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2,
  Save,
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
  cuentas_por_cobrar: 'Cuentas por cobrar',
  anticipos_a_proveedores: 'Anticipos a proveedores',
  anticipos_de_clientes: 'Anticipos de clientes',
  cuentas_por_pagar: 'Cuentas por pagar',
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

function DetailSection({
  fieldType, label, items, onAdd, onRemove, onUpdate, disabled, responsibles,
}: {
  fieldType: DetailFieldType;
  label: string;
  items: InitialStateDetail[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: 'responsible_name' | 'amount', value: string | number) => void;
  disabled: boolean;
  responsibles: Responsible[];
}) {
  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs font-medium text-muted-foreground">{formatCurrency(total)}</span>
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            value={item.responsible_name}
            onChange={(e) => onUpdate(idx, 'responsible_name', e.target.value)}
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
              onChange={(e) => onUpdate(idx, 'amount', Number(e.target.value) || 0)}
              disabled={disabled}
              className="pl-6 text-right text-sm"
              placeholder="0"
            />
          </div>
          {!disabled && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onRemove(idx)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
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
  const { data, details: savedDetails, loading, isConfigured, save } = useInitialFinancialState();
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<InitialStateFormData>(DEFAULT_FORM);
  const [details, setDetails] = useState<InitialStateDetail[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);

  const isReadOnly = isConfigured && !editing;

  // Load responsibles
  useEffect(() => {
    if (!user) return;
    supabase.from('responsibles').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setResponsibles((data as Responsible[]) || []));
  }, [user]);

  useEffect(() => {
    if (data) {
      setForm({
        fecha_inicio: data.fecha_inicio,
        saldo_bancos: data.saldo_bancos,
        inventario: data.inventario,
        otros_activos: data.otros_activos,
        impuestos_por_pagar: data.impuestos_por_pagar,
        prestamos: data.prestamos,
        iva_a_favor: data.iva_a_favor,
      });
    }
    setDetails(savedDetails.map(d => ({ ...d })));
  }, [data, savedDetails]);

  const update = (field: keyof InitialStateFormData, value: number | string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addDetail = (fieldType: DetailFieldType) => {
    setDetails(prev => [...prev, { field_type: fieldType, responsible_id: null, responsible_name: '', amount: 0 }]);
  };

  const removeDetail = (index: number) => {
    setDetails(prev => prev.filter((_, i) => i !== index));
  };

  const updateDetail = (index: number, field: 'responsible_name' | 'amount', value: string | number) => {
    setDetails(prev => prev.map((d, i) => {
      if (i !== index) return d;
      const updated = { ...d, [field]: value };
      // Try to match responsible_id by name
      if (field === 'responsible_name') {
        const match = responsibles.find(r => r.name.toLowerCase() === (value as string).toLowerCase());
        updated.responsible_id = match?.id || null;
      }
      return updated;
    }));
  };

  const getItemsForType = (type: DetailFieldType) => details.filter(d => d.field_type === type);

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
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-muted-foreground" />
            Estado inicial financiero
          </CardTitle>
          <CardDescription>
            {isConfigured
              ? 'Saldos con los que comenzaste a usar AluminIA. Estos son el punto de partida de tus reportes.'
              : 'Configura el punto de partida financiero de tu negocio. Usa los valores declarados en tus estados financieros o balance del contador.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Fecha inicio */}
          <div className="space-y-2">
            <Label htmlFor="fecha_inicio" className="font-medium">Fecha de inicio en AluminIA</Label>
            <Input
              id="fecha_inicio" type="date" value={form.fecha_inicio}
              onChange={(e) => update('fecha_inicio', e.target.value)}
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
              <CurrencyInput id="saldo_bancos" label="Saldo en bancos" value={form.saldo_bancos} onChange={(v) => update('saldo_bancos', v)} disabled={isReadOnly} />
              <CurrencyInput id="inventario" label="Inventario" value={form.inventario} onChange={(v) => update('inventario', v)} disabled={isReadOnly} />
              <CurrencyInput id="otros_activos" label="Otros activos" value={form.otros_activos} onChange={(v) => update('otros_activos', v)} disabled={isReadOnly} />
            </div>
            <Separator className="my-2" />
            <DetailSection
              fieldType="cuentas_por_cobrar" label="Cuentas por cobrar (por tercero)"
              items={getItemsForType('cuentas_por_cobrar')}
              onAdd={() => addDetail('cuentas_por_cobrar')}
              onRemove={(idx) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'cuentas_por_cobrar');
                removeDetail(allOfType[idx].i);
              }}
              onUpdate={(idx, field, value) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'cuentas_por_cobrar');
                updateDetail(allOfType[idx].i, field, value);
              }}
              disabled={isReadOnly} responsibles={responsibles}
            />
            <DetailSection
              fieldType="anticipos_a_proveedores" label="Anticipos a proveedores (por tercero)"
              items={getItemsForType('anticipos_a_proveedores')}
              onAdd={() => addDetail('anticipos_a_proveedores')}
              onRemove={(idx) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'anticipos_a_proveedores');
                removeDetail(allOfType[idx].i);
              }}
              onUpdate={(idx, field, value) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'anticipos_a_proveedores');
                updateDetail(allOfType[idx].i, field, value);
              }}
              disabled={isReadOnly} responsibles={responsibles}
            />
          </div>

          <Separator />

          {/* Pasivos */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-red-500" />
              <h3 className="font-medium text-sm">Pasivos</h3>
              <span className="ml-auto text-sm font-semibold text-red-600">{formatCurrency(totalPasivos)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CurrencyInput id="impuestos_por_pagar" label="Impuestos por pagar" value={form.impuestos_por_pagar} onChange={(v) => update('impuestos_por_pagar', v)} disabled={isReadOnly} />
              <CurrencyInput id="prestamos" label="Préstamos" value={form.prestamos} onChange={(v) => update('prestamos', v)} disabled={isReadOnly} />
            </div>
            <Separator className="my-2" />
            <DetailSection
              fieldType="cuentas_por_pagar" label="Cuentas por pagar (por tercero)"
              items={getItemsForType('cuentas_por_pagar')}
              onAdd={() => addDetail('cuentas_por_pagar')}
              onRemove={(idx) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'cuentas_por_pagar');
                removeDetail(allOfType[idx].i);
              }}
              onUpdate={(idx, field, value) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'cuentas_por_pagar');
                updateDetail(allOfType[idx].i, field, value);
              }}
              disabled={isReadOnly} responsibles={responsibles}
            />
            <DetailSection
              fieldType="anticipos_de_clientes" label="Anticipos de clientes (por tercero)"
              items={getItemsForType('anticipos_de_clientes')}
              onAdd={() => addDetail('anticipos_de_clientes')}
              onRemove={(idx) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'anticipos_de_clientes');
                removeDetail(allOfType[idx].i);
              }}
              onUpdate={(idx, field, value) => {
                const allOfType = details.map((d, i) => ({ d, i })).filter(x => x.d.field_type === 'anticipos_de_clientes');
                updateDetail(allOfType[idx].i, field, value);
              }}
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
            <CurrencyInput id="iva_a_favor" label="IVA a favor" value={form.iva_a_favor} onChange={(v) => update('iva_a_favor', v)} disabled={isReadOnly} />
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
              <span>Total Pasivos</span>
              <span className="font-semibold text-red-600">{formatCurrency(totalPasivos)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm font-medium">
              <span>Patrimonio (Activos − Pasivos)</span>
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
                <Button onClick={handleSave} disabled={saving || !form.fecha_inicio}>
                  {saving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" />{isConfigured ? 'Guardar cambios' : 'Guardar estado inicial'}</>
                  )}
                </Button>
                {editing && (
                  <Button variant="ghost" onClick={() => {
                    setEditing(false);
                    if (data) {
                      setForm({
                        fecha_inicio: data.fecha_inicio,
                        saldo_bancos: data.saldo_bancos,
                        inventario: data.inventario,
                        otros_activos: data.otros_activos,
                        impuestos_por_pagar: data.impuestos_por_pagar,
                        prestamos: data.prestamos,
                        iva_a_favor: data.iva_a_favor,
                      });
                    }
                    setDetails(savedDetails.map(d => ({ ...d })));
                  }}>
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
