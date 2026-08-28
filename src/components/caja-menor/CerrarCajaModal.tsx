import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Lock, Loader2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { safeParseFloat } from '@/lib/numberUtils';
import { useToast } from '@/hooks/use-toast';
import { useClosePettyCashPeriod, usePettyCashClosings } from '@/hooks/usePettyCashClosings';
import { accountsPresentes } from '@/lib/pettyCashAccounts';
import type { PettyCashRow } from '@/hooks/usePettyCashMovements';
import { computeClosingBalance } from '@/lib/pettyCashClosing';

interface Props {
  open: boolean;
  onClose: () => void;
  rows: PettyCashRow[];
}

function startOfCurrentMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function endOfCurrentMonth(): string {
  const d = new Date();
  // Date(year, month+1, 0) = último día del mes actual.
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function CerrarCajaModal({ open, onClose, rows }: Props) {
  const { toast } = useToast();
  const closeMutation = useClosePettyCashPeriod();
  // Cierres previos: sus diferencias son plata real que existe en la caja.
  const { data: closings = [] } = usePettyCashClosings();

  const [periodStart, setPeriodStart] = useState(startOfCurrentMonth());
  const [periodEnd, setPeriodEnd] = useState(endOfCurrentMonth());
  // Un declarado por cuenta: { efectivo: '800000', nequi: '240000' }
  const [declaradoStr, setDeclaradoStr] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  // Reset form al abrir
  useEffect(() => {
    if (open) {
      setPeriodStart(startOfCurrentMonth());
      setPeriodEnd(endOfCurrentMonth());
      setDeclaradoStr({});
      setNotes('');
    }
  }, [open]);

  // Movimientos abiertos en el período seleccionado.
  const periodRows = useMemo(() => {
    return rows.filter(
      (r) => r.date >= periodStart && r.date <= periodEnd && !(r as any).closing_id,
    );
  }, [rows, periodStart, periodEnd]);

  // ARRASTRE + saldo esperado: la cuenta vive en lib/pettyCashClosing (con
  // tests, incluido el caso real de agosto 2026 que destapó el bug: el cierre
  // computaba solo el neto del período e ignoraba la plata que ya había en la
  // caja, dando un "debería haber" NEGATIVO y un sobrante falso).
  const balance = useMemo(
    () => computeClosingBalance(rows, periodRows, periodStart, closings),
    [rows, periodRows, periodStart, closings],
  );
  const { arrastreTotal, totalIngresos, totalEgresos, computadoPorCuenta, computedBalance } = balance;

  // Solo se pide declarar las cuentas que participan del cierre (las que
  // tuvieron movimiento en el período o traen saldo de arrastre).
  const cuentasDelPeriodo = useMemo(
    () => accountsPresentes(Object.keys(computadoPorCuenta)).filter((a) => a.id in computadoPorCuenta),
    [computadoPorCuenta],
  );

  const declaradosPorCuenta = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of cuentasDelPeriodo) m[a.id] = safeParseFloat(declaradoStr[a.id] ?? '');
    return m;
  }, [cuentasDelPeriodo, declaradoStr]);
  const declaredBalance = Object.values(declaradosPorCuenta).reduce((s, v) => s + v, 0);
  const difference = declaredBalance - computedBalance;
  const faltaDeclarar = cuentasDelPeriodo.some((a) => !(declaradoStr[a.id] ?? '').trim());

  const handleConfirm = async () => {
    if (periodRows.length === 0) {
      toast({
        title: 'No hay movimientos',
        description: 'No hay movimientos abiertos en el período seleccionado.',
        variant: 'destructive',
      });
      return;
    }
    if (faltaDeclarar) {
      toast({
        title: 'Falta saldo declarado',
        description: 'Ingresá el saldo de cada cuenta que tuvo movimientos.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await closeMutation.mutateAsync({
        period_start: periodStart,
        period_end: periodEnd,
        declared_balance: declaredBalance,
        notes: notes.trim() || undefined,
        declarados_por_cuenta: declaradosPorCuenta,
      });
      toast({
        title: 'Caja cerrada',
        description: `${periodRows.length} movimientos cerrados. Diferencia: ${formatCurrency(difference)}.`,
      });
      onClose();
    } catch (err: any) {
      toast({
        title: 'Error al cerrar caja',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    }
  };

  const isProcessing = closeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isProcessing) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Cerrar caja menor</DialogTitle>
              <DialogDescription className="mt-1">
                Cierra el período: marca los movimientos como inmutables, registra el saldo físico y la diferencia (sobrante/faltante).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Período */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="period_start">Desde</Label>
              <Input id="period_start" type="date" value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)} disabled={isProcessing} />
            </div>
            <div>
              <Label htmlFor="period_end">Hasta</Label>
              <Input id="period_end" type="date" value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)} disabled={isProcessing} />
            </div>
          </div>

          {/* Resumen computado */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Movimientos del período</span>
              <span className="tabular-nums">{periodRows.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground" title="Lo que ya había en la caja el primer día del período (movimientos anteriores + diferencias de cierres previos)">
                Saldo al {new Date(periodStart + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
              </span>
              <span className="tabular-nums">{formatCurrency(arrastreTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total ingresos</span>
              <span className="tabular-nums text-success">+{formatCurrency(totalIngresos)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total egresos</span>
              <span className="tabular-nums text-destructive">−{formatCurrency(totalEgresos)}</span>
            </div>
            <div className="flex justify-between font-medium pt-1.5 border-t">
              <span>Debería haber en caja</span>
              <span className={`tabular-nums ${computedBalance >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                {formatCurrency(computedBalance)}
              </span>
            </div>
            {computedBalance < 0 && (
              <p className="text-[11px] text-destructive pt-1">
                Dio negativo, y eso no puede pasar en una caja física: salió más plata de la que
                entró. Casi siempre falta cargar ingresos del período, o el saldo con que arrancó
                la caja no está registrado.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground pt-1">
              Arranca con lo que ya había en la caja y le aplica los movimientos del período.
              Declará abajo la plata que contaste de verdad.
            </p>
          </div>

          {/* Saldo declarado POR CUENTA. Cada cuenta se verifica contra algo
              distinto, así que un total único escondería dónde está el hueco. */}
          <div className="space-y-2">
            <Label>Saldo declarado por cuenta</Label>
            {cuentasDelPeriodo.map((a, i) => {
              const computado = computadoPorCuenta[a.id] ?? 0;
              const declarado = declaradosPorCuenta[a.id] ?? 0;
              const dif = declarado - computado;
              const tocado = (declaradoStr[a.id] ?? '').trim() !== '';
              return (
                <div key={a.id} className="rounded-md border p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{a.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      Debería haber <span className="tabular-nums font-medium text-foreground">{formatCurrency(computado)}</span>
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="1"
                    placeholder={a.comoSeVerifica}
                    value={declaradoStr[a.id] ?? ''}
                    onChange={(e) => setDeclaradoStr((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    disabled={isProcessing}
                    autoFocus={i === 0}
                  />
                  {tocado && (
                    <p className={`text-[11px] ${Math.abs(dif) < 1 ? 'text-success' : 'text-warning'}`}>
                      {Math.abs(dif) < 1
                        ? 'Cuadra.'
                        : `${dif > 0 ? 'Sobran' : 'Faltan'} ${formatCurrency(Math.abs(dif))} en ${a.label}.`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Diferencia */}
          {!faltaDeclarar && cuentasDelPeriodo.length > 0 && (
            <div
              className={`rounded-md border p-3 flex items-start gap-2 ${
                Math.abs(difference) < 1
                  ? 'bg-success/10 border-success/30'
                  : 'bg-warning/10 border-warning/30'
              }`}
            >
              <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
                Math.abs(difference) < 1 ? 'text-success' : 'text-warning'
              }`} />
              <div className="text-xs">
                <div className="font-medium">
                  Diferencia total: {formatCurrency(difference)}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {Math.abs(difference) < 1
                    ? 'Caja cuadra perfecto.'
                    : difference > 0
                      ? 'Sobra plata vs lo registrado (revisá si te falta cargar algún ingreso).'
                      : 'Falta plata vs lo registrado (revisá si hay gasto sin registrar o error de conteo).'}
                </div>
              </div>
            </div>
          )}

          {/* Notas */}
          <div>
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Ej: cierre de octubre, diferencia por almuerzo de equipo no registrado"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isProcessing}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isProcessing || periodRows.length === 0}>
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Cerrando...</>
            ) : (
              <><Lock className="h-4 w-4 mr-1.5" /> Confirmar cierre</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
