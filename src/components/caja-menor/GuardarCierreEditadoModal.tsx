import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Lock, Loader2, AlertTriangle, PlusCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { safeParseFloat } from '@/lib/numberUtils';
import { useToast } from '@/hooks/use-toast';
import { useReclosePettyCashClosing, type PettyCashClosing } from '@/hooks/usePettyCashClosings';
import type { PettyCashRow } from '@/hooks/usePettyCashMovements';

interface Props {
  closing: PettyCashClosing | null;
  rows: PettyCashRow[];
  onClose: () => void;
}

/**
 * Guardar de nuevo un cierre que estaba en edición.
 *
 * A diferencia de CerrarCajaModal (que arma un cierre nuevo con los
 * movimientos sueltos de un período que elegís), acá el período ya está fijo:
 * es el del cierre reabierto. Los movimientos que se hayan cargado dentro de
 * ese rango mientras estaba en edición se absorben al guardar — es el caso de
 * uso entero de reabrir: meter el gasto que faltaba.
 */
export default function GuardarCierreEditadoModal({ closing, rows, onClose }: Props) {
  const { toast } = useToast();
  const recloseMutation = useReclosePettyCashClosing();

  const [declaredStr, setDeclaredStr] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (closing) {
      setDeclaredStr(closing.declared_balance ? String(closing.declared_balance) : '');
      setNotes(closing.notes ?? '');
    }
  }, [closing]);

  // Los que ya están en el cierre + los sueltos que caen dentro del período
  // (esos los va a absorber el guardado).
  const { delCierre, aAbsorber } = useMemo(() => {
    if (!closing) return { delCierre: [] as PettyCashRow[], aAbsorber: [] as PettyCashRow[] };
    return {
      delCierre: rows.filter((r) => r.closing_id === closing.id),
      aAbsorber: rows.filter(
        (r) => !r.closing_id && r.date >= closing.period_start && r.date <= closing.period_end,
      ),
    };
  }, [rows, closing]);

  const finales = useMemo(() => [...delCierre, ...aAbsorber], [delCierre, aAbsorber]);

  const { totalIngresos, totalEgresos } = useMemo(() => {
    let ing = 0;
    let egr = 0;
    for (const r of finales) {
      if (r.kind === 'ingreso_efectivo') ing += r.amount;
      else egr += r.amount;
    }
    return { totalIngresos: ing, totalEgresos: egr };
  }, [finales]);

  const computedBalance = totalIngresos - totalEgresos;
  const declaredBalance = safeParseFloat(declaredStr);
  const difference = declaredBalance - computedBalance;
  const isProcessing = recloseMutation.isPending;

  const handleConfirm = async () => {
    if (!closing) return;
    if (!declaredStr.trim()) {
      toast({
        title: 'Falta saldo declarado',
        description: 'Ingresá el saldo físico que tenés en caja.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await recloseMutation.mutateAsync({
        closingId: closing.id,
        declared_balance: declaredBalance,
        notes: notes.trim() || undefined,
      });
      toast({
        title: 'Cierre guardado',
        description: res?.movements_absorbed
          ? `${res.movements_count} movimientos (${res.movements_absorbed} nuevos absorbidos). Diferencia: ${formatCurrency(difference)}.`
          : `${res?.movements_count ?? finales.length} movimientos. Diferencia: ${formatCurrency(difference)}.`,
      });
      onClose();
    } catch (err: any) {
      toast({
        title: 'Error al guardar el cierre',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={closing !== null} onOpenChange={(o) => { if (!o && !isProcessing) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Guardar cierre editado</DialogTitle>
              <DialogDescription className="mt-1">
                {closing && (
                  <>Período {closing.period_start} al {closing.period_end}. Vuelve a quedar cerrado e inmutable.</>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {aAbsorber.length > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-start gap-2">
              <PlusCircle className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div className="text-xs">
                <p className="font-medium text-foreground">
                  {aAbsorber.length} movimiento(s) nuevo(s) entran a este cierre
                </p>
                <p className="text-muted-foreground mt-0.5">
                  Son los que cargaste dentro del período mientras estaba en edición.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Movimientos del cierre</span>
              <span className="tabular-nums">{finales.length}</span>
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
          </div>

          <div>
            <Label htmlFor="reclose_declared">Saldo físico declarado</Label>
            <Input
              id="reclose_declared"
              type="number"
              step="1"
              min={0}
              placeholder="Cuántos pesos hay físicamente en la caja"
              value={declaredStr}
              onChange={(e) => setDeclaredStr(e.target.value)}
              disabled={isProcessing}
              autoFocus
            />
          </div>

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
                <p className="font-medium">Diferencia: {formatCurrency(difference)}</p>
                <p className="text-muted-foreground mt-0.5">
                  {Math.abs(difference) < 1
                    ? 'Caja cuadra perfecto.'
                    : difference > 0
                      ? 'Sobrante: hay más plata física que la registrada.'
                      : 'Faltante: falta plata vs lo registrado.'}
                </p>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="reclose_notes">Notas (opcional)</Label>
            <Textarea
              id="reclose_notes"
              rows={2}
              placeholder="Por qué se reabrió, qué se corrigió…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isProcessing}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={isProcessing}>
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Guardar y cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
