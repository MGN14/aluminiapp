import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { suggestPaymentSplit, simulateExtraPayment } from '@/lib/amortization';
import type { CreditWithSummary, CreditPayment } from '@/hooks/useCredits';
import { TrendingDown, Pencil } from 'lucide-react';

export interface PrefillCuota {
  fecha: string;
  cuotaTotal: number;
  capitalEfectivo: number;
  interesEfectivo: number;
  cuotaNumero: number;
}

interface Props {
  credit: CreditWithSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillCuota?: PrefillCuota | null;
  /** Modo edición: corrige un pago ya registrado (fecha, montos, extra). */
  editingPayment?: CreditPayment | null;
  /** Abrir con "abono extraordinario a capital" ya activado (botón ↓ de una cuota pagada). */
  prefillExtra?: boolean;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

export default function RegistrarPagoCreditoModal({ credit, open, onOpenChange, prefillCuota, editingPayment, prefillExtra }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const isEdit = !!editingPayment;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [isExtra, setIsExtra] = useState(false);
  const [principalPart, setPrincipalPart] = useState('');
  const [interestPart, setInterestPart] = useState('');
  const [notes, setNotes] = useState('');

  // Pre-fill: pago existente (modo edición) o cuota seleccionada ("Pagar esta cuota")
  useEffect(() => {
    if (!open) return;
    if (editingPayment) {
      setDate(editingPayment.payment_date);
      setAmount(String(Math.round(Number(editingPayment.amount_paid))));
      setIsExtra(editingPayment.is_extra);
      setPrincipalPart(String(Math.round(Number(editingPayment.principal_paid))));
      setInterestPart(String(Math.round(Number(editingPayment.interest_paid))));
      setNotes(editingPayment.notes ?? '');
    } else if (prefillCuota) {
      setDate(new Date().toISOString().slice(0, 10));
      setAmount(String(Math.round(prefillCuota.cuotaTotal)));
      setIsExtra(false);
      setPrincipalPart(String(Math.round(prefillCuota.capitalEfectivo)));
      setInterestPart(String(Math.round(prefillCuota.interesEfectivo)));
      setNotes(`Cuota #${prefillCuota.cuotaNumero}`);
    } else if (prefillExtra) {
      // Abono extra desde el botón ↓ de una cuota pagada: switch activado,
      // fecha hoy, monto vacío para que Nico lo tipee.
      setDate(new Date().toISOString().slice(0, 10));
      setAmount('');
      setIsExtra(true);
      setPrincipalPart('');
      setInterestPart('');
      setNotes('Abono extraordinario a capital');
    }
  }, [prefillCuota, editingPayment, prefillExtra, open]);

  // Auto-sugerencia de split cuando cambia monto o isExtra (solo si no hay prefill activo)
  useEffect(() => {
    if (!credit) return;
    if (prefillCuota || editingPayment) return; // respetar prefill explícito
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      setPrincipalPart('');
      setInterestPart('');
      return;
    }
    const split = suggestPaymentSplit(
      credit.summary.currentBalance,
      Number(credit.credit.interest_rate_monthly),
      num,
      isExtra,
    );
    setPrincipalPart(split.principal.toString());
    setInterestPart(split.interest.toString());
  }, [amount, isExtra, credit, prefillCuota, editingPayment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !credit) return;
    const num = parseFloat(amount);
    const cap = parseFloat(principalPart) || 0;
    const intr = parseFloat(interestPart) || 0;
    if (!num || num <= 0) {
      toast({ title: 'Monto inválido', variant: 'destructive' });
      return;
    }
    if (Math.abs(cap + intr - num) > 0.5) {
      toast({ title: 'Capital + Interés debe igualar el monto', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editingPayment) {
        // Modo edición: corrige el pago existente (fecha corrida por festivo,
        // montos mal partidos, extra marcado por error).
        const { error } = await (supabase.from('credit_payments' as never) as any)
          .update({
            payment_date: date,
            amount_paid: num,
            principal_paid: cap,
            interest_paid: intr,
            is_extra: isExtra,
            notes: notes.trim() || null,
          })
          .eq('id', editingPayment.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from('credit_payments' as never) as any).insert({
          user_id: user.id,
          credit_id: credit.credit.id,
          payment_date: date,
          amount_paid: num,
          principal_paid: cap,
          interest_paid: intr,
          is_extra: isExtra,
          notes: notes.trim() || null,
        });
        if (error) throw error;
      }

      // Recalcular estado del crédito con el capital neto del cambio.
      const capViejo = isEdit && editingPayment ? Number(editingPayment.principal_paid) : 0;
      const newBalance = credit.summary.currentBalance + capViejo - cap;
      if (newBalance <= 0.5 && credit.credit.status !== 'paid') {
        await (supabase.from('credits' as never) as any)
          .update({ status: 'paid' })
          .eq('id', credit.credit.id);
        toast({ title: 'Crédito pagado', description: '¡Felicitaciones! Saldo en cero.' });
      } else if (newBalance > 0.5 && credit.credit.status === 'paid') {
        // La corrección revivió saldo → el crédito vuelve a activo.
        await (supabase.from('credits' as never) as any)
          .update({ status: 'active' })
          .eq('id', credit.credit.id);
        toast({ title: isEdit ? 'Pago corregido' : 'Pago registrado', description: 'El crédito volvió a estado activo (quedó saldo pendiente).' });
      } else {
        toast({ title: isEdit ? 'Pago corregido' : 'Pago registrado' });
      }

      await queryClient.invalidateQueries({ queryKey: ['credits'] });
      setAmount(''); setPrincipalPart(''); setInterestPart(''); setNotes('');
      setIsExtra(false);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isEdit && <Pencil className="h-4 w-4 text-warning" />}
              {isEdit ? 'Corregir pago' : 'Registrar pago'} — {credit?.credit.name}
            </DialogTitle>
          </DialogHeader>

          {isEdit && (
            <p className="text-xs text-muted-foreground -mt-2">
              Estás corrigiendo el pago del {editingPayment?.payment_date}. La tabla de cuotas
              se recalcula sola al guardar.
            </p>
          )}

          {credit && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Saldo actual</span>
                <span className="font-bold">{fmt(credit.summary.currentBalance)}</span>
              </div>
              {credit.summary.nextCuota && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Próxima cuota teórica</span>
                  <span>{fmt(credit.summary.nextCuota.cuotaTotal)} ({credit.summary.nextCuota.fecha})</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Monto pagado</Label>
              <Input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 p-2 rounded-lg border">
            <div className="text-xs">
              <p className="font-medium">¿Es abono extraordinario a capital?</p>
              <p className="text-muted-foreground">Activá si va 100% a capital sin pagar interés del mes.</p>
            </div>
            <Switch checked={isExtra} onCheckedChange={setIsExtra} />
          </div>

          {/* Simulador: si es abono extra, mostrar ahorro estimado */}
          {credit && isExtra && parseFloat(amount) > 0 && (() => {
            const remainingMonths = credit.summary.schedule.filter(r => {
              const today = new Date().toISOString().slice(0, 10);
              return r.fecha >= today;
            }).length;
            const sim = simulateExtraPayment(
              credit.summary.currentBalance,
              Number(credit.credit.interest_rate_monthly),
              remainingMonths,
              parseFloat(amount),
              credit.credit.amortization_type,
            );
            if (sim.interestSavedReducingTerm <= 0 && sim.interestSavedKeepingTerm <= 0) return null;
            return (
              <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-success">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Simulación del abono
                </div>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider">Saldo después del abono</p>
                    <p className="font-bold text-foreground">{fmt(sim.newBalance)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider">Reduciendo plazo</p>
                    <p className="font-bold text-success">{fmt(sim.interestSavedReducingTerm)}</p>
                    <p className="text-[10px]">{sim.monthsSavedReducingTerm} meses menos</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-success/20">
                  Estimación: si seguís pagando la cuota actual, terminás antes y ahorrás intereses. Si reducís cuota manteniendo plazo: ahorrás aprox {fmt(sim.interestSavedKeepingTerm)}.
                </p>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Capital</Label>
              <Input type="number" min="0" step="1" value={principalPart} onChange={(e) => setPrincipalPart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Interés</Label>
              <Input type="number" min="0" step="1" value={interestPart} onChange={(e) => setInterestPart(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar corrección' : 'Registrar pago'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
