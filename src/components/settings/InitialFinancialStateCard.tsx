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
  type InitialStateFormData,
} from '@/hooks/useInitialFinancialState';
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
} from 'lucide-react';

const DEFAULT_FORM: InitialStateFormData = {
  fecha_inicio: new Date().toISOString().slice(0, 10),
  saldo_bancos: 0,
  cuentas_por_cobrar: 0,
  inventario: 0,
  anticipos_a_proveedores: 0,
  otros_activos: 0,
  cuentas_por_pagar: 0,
  anticipos_de_clientes: 0,
  impuestos_por_pagar: 0,
  prestamos: 0,
  iva_a_favor: 0,
  iva_por_pagar: 0,
  retefuente_por_pagar: 0,
  ica_por_pagar: 0,
};

function CurrencyInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          id={id}
          type="number"
          min={0}
          step="0.01"
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          disabled={disabled}
          className="pl-7 text-right"
          placeholder="0"
        />
      </div>
    </div>
  );
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
}

export default function InitialFinancialStateCard() {
  const { data, loading, isConfigured, save } = useInitialFinancialState();
  const { toast } = useToast();
  const [form, setForm] = useState<InitialStateFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isReadOnly = isConfigured && !editing;

  useEffect(() => {
    if (data) {
      const { id, user_id, created_at, updated_at, ...rest } = data;
      setForm(rest);
    }
  }, [data]);

  const update = (field: keyof InitialStateFormData, value: number | string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const totalActivos = useMemo(() => getTotalActivos(form), [form]);
  const totalPasivos = useMemo(() => getTotalPasivos(form), [form]);
  const patrimonio = useMemo(() => getPatrimonio(form), [form]);
  const isBalanced = Math.abs(totalActivos - (totalPasivos + patrimonio)) < 0.01;

  const handleSave = async () => {
    if (isConfigured && !editing) return;
    // If editing existing, require confirmation
    if (isConfigured && editing) {
      setShowConfirm(true);
      return;
    }
    await doSave();
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await save(form);
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
            <Label htmlFor="fecha_inicio" className="font-medium">
              Fecha de inicio en AluminIA
            </Label>
            <Input
              id="fecha_inicio"
              type="date"
              value={form.fecha_inicio}
              onChange={(e) => update('fecha_inicio', e.target.value)}
              disabled={isReadOnly}
              className="w-48"
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
              <CurrencyInput id="cuentas_por_cobrar" label="Cuentas por cobrar" value={form.cuentas_por_cobrar} onChange={(v) => update('cuentas_por_cobrar', v)} disabled={isReadOnly} />
              <CurrencyInput id="inventario" label="Inventario" value={form.inventario} onChange={(v) => update('inventario', v)} disabled={isReadOnly} />
              <CurrencyInput id="anticipos_a_proveedores" label="Anticipos a proveedores" value={form.anticipos_a_proveedores} onChange={(v) => update('anticipos_a_proveedores', v)} disabled={isReadOnly} />
              <CurrencyInput id="otros_activos" label="Otros activos" value={form.otros_activos} onChange={(v) => update('otros_activos', v)} disabled={isReadOnly} />
            </div>
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
              <CurrencyInput id="cuentas_por_pagar" label="Cuentas por pagar" value={form.cuentas_por_pagar} onChange={(v) => update('cuentas_por_pagar', v)} disabled={isReadOnly} />
              <CurrencyInput id="anticipos_de_clientes" label="Anticipos de clientes" value={form.anticipos_de_clientes} onChange={(v) => update('anticipos_de_clientes', v)} disabled={isReadOnly} />
              <CurrencyInput id="impuestos_por_pagar" label="Impuestos por pagar" value={form.impuestos_por_pagar} onChange={(v) => update('impuestos_por_pagar', v)} disabled={isReadOnly} />
              <CurrencyInput id="prestamos" label="Préstamos" value={form.prestamos} onChange={(v) => update('prestamos', v)} disabled={isReadOnly} />
            </div>
          </div>

          <Separator />

          {/* Impuestos */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-500" />
              <h3 className="font-medium text-sm">Impuestos (saldos iniciales)</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CurrencyInput id="iva_a_favor" label="IVA a favor" value={form.iva_a_favor} onChange={(v) => update('iva_a_favor', v)} disabled={isReadOnly} />
              <CurrencyInput id="iva_por_pagar" label="IVA por pagar" value={form.iva_por_pagar} onChange={(v) => update('iva_por_pagar', v)} disabled={isReadOnly} />
              <CurrencyInput id="retefuente_por_pagar" label="Retefuente por pagar" value={form.retefuente_por_pagar} onChange={(v) => update('retefuente_por_pagar', v)} disabled={isReadOnly} />
              <CurrencyInput id="ica_por_pagar" label="ICA por pagar" value={form.ica_por_pagar} onChange={(v) => update('ica_por_pagar', v)} disabled={isReadOnly} />
            </div>
          </div>

          <Separator />

          {/* Resumen / Validación */}
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
            {isBalanced ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 mt-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ecuación contable equilibrada
              </div>
            ) : null}
          </div>

          {/* Warning if not balanced and values are non-zero */}
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
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {isConfigured ? 'Guardar cambios' : 'Guardar estado inicial'}
                    </>
                  )}
                </Button>
                {editing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      if (data) {
                        const { id, user_id, created_at, updated_at, ...rest } = data;
                        setForm(rest);
                      }
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog for editing */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Modificar estado inicial?</AlertDialogTitle>
            <AlertDialogDescription>
              Cambiar los saldos iniciales afectará todos los cálculos, reportes y el score financiero. ¿Estás seguro de que deseas continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowConfirm(false);
                doSave();
              }}
            >
              Confirmar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
