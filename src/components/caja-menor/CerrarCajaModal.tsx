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
import { useClosePettyCashPeriod } from '@/hooks/usePettyCashClosings';
import type { PettyCashRow } from '@/hooks/usePettyCashMovements';

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

  const [periodStart, setPeriodStart] = useState(startOfCurrentMonth());
  const [periodEnd, setPeriodEnd] = useState(endOfCurrentMonth());
  const [declaredStr, setDeclaredStr] = useState('');
  const [notes, setNotes] = useState('');

  // Reset form al abrir
  useEffect(() => {
    if (open) {
      setPeriodStart(startOfCurrentMonth());
      setPeriodEnd(endOfCurrentMonth());
      setDeclaredStr('');
      setNotes('');
    }
  }, [open]);

  // Movimientos abiertos en el período seleccionado.
  const periodRows = useMemo(() => {
    return rows.filter(
      (r) => r.date >= periodStart && r.date <= periodEnd && !(r as any).closing_id,
    );
  }, [rows, periodStart, periodEnd]);

  // Separar ingresos de egresos por kind. Antes se sumaba TODO como egreso
  // (bug: el saldo computado quedaba -ingresos-egresos en lugar del neto).
  const { totalIngresos, totalEgresos } = useMemo(() => {
    let ing = 0;
    let egr = 0;
    for (const r of periodRows) {
      if (r.kind === 'ingreso_efectivo') ing += r.amount;
      else egr += r.amount;
    }
    return { totalIngresos: ing, totalEgresos: egr };
  }, [periodRows]);

  // Saldo computado = neto del período: ingresos suman, egresos restan.
  const computedBalance = totalIngresos - totalEgresos;
  const declaredBalance = safeParseFloat(declaredStr);
  const difference = declaredBalance - computedBalance;

  const handleConfirm = async () => {
    if (periodRows.length === 0) {
      toast({
        title: 'No hay movimientos',
        description: 'No hay movimientos abiertos en el período seleccionado.',
        variant: 'destructive',
      });
      return;
    }
    if (!declaredStr.trim()) {
      toast({
        title: 'Falta saldo declarado',
        description: 'Ingresá el saldo físico que tenés en caja.',
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
              <span className="text-muted-foreground">Total ingresos</span>
              <span className="tabular-nums text-success">+{formatCurrency(totalIngresos)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total egresos</span>
              <span className="tabular-nums text-destructive">−{formatCurrency(totalEgresos)}</span>
            </div>
            <div className="flex justify-between font-medium pt-1.5 border-t">
              <span>Saldo computado (neto)</span>
              <span className={`tabular-nums ${computedBalance >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                {formatCurrency(computedBalance)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1">
              El saldo computado es lo que <em>debería</em> haber en caja según los movimientos
              (ingresos − egresos). Si arrancaste el período con plata previa, sumala a tu saldo declarado.
            </p>
          </div>

          {/* Saldo declarado */}
          <div>
            <Label htmlFor="declared_balance">Saldo físico declarado</Label>
            <Input
              id="declared_balance"
              type="number"
              step="1"
              min={0}
              placeholder="Cuántos pesos hay físicamente en la caja al cerrar"
              value={declaredStr}
              onChange={(e) => setDeclaredStr(e.target.value)}
              disabled={isProcessing}
              autoFocus
            />
          </div>

          {/* Diferencia */}
          {declaredStr.trim() !== '' && (
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
                  Diferencia: {formatCurrency(difference)}
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
