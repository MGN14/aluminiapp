import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { frenchPayment, type AmortizationType } from '@/lib/amortization';

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

export default function NuevoCreditoModal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [term, setTerm] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [firstPaymentDate, setFirstPaymentDate] = useState('');
  const [amortizationType, setAmortizationType] = useState<AmortizationType>('francesa');
  const [extraCostsPct, setExtraCostsPct] = useState('');
  const [extraCostsLabel, setExtraCostsLabel] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setName(''); setBankName(''); setPrincipal(''); setRate(''); setTerm('');
    setStartDate(new Date().toISOString().slice(0, 10));
    setFirstPaymentDate('');
    setAmortizationType('francesa');
    setExtraCostsPct(''); setExtraCostsLabel('');
    setNotes('');
  };

  // Preview cuota estimada
  const previewCuota = (() => {
    const p = parseFloat(principal);
    const r = parseFloat(rate);
    const t = parseInt(term);
    if (!p || !t || isNaN(r)) return null;
    const i = r / 100;
    if (amortizationType === 'francesa') return frenchPayment(p, i, t);
    if (amortizationType === 'alemana') return p / t + p * i; // primera cuota (la más alta)
    return p * i; // bullet: cuota mensual = solo interés
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!name.trim() || !principal || !rate || !term || !startDate || !firstPaymentDate) {
      toast({ title: 'Faltan datos', description: 'Completá todos los campos requeridos.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase.from('credits' as never) as any).insert({
        user_id: user.id,
        name: name.trim(),
        bank_name: bankName.trim() || null,
        principal: parseFloat(principal),
        interest_rate_monthly: parseFloat(rate),
        term_months: parseInt(term),
        start_date: startDate,
        first_payment_date: firstPaymentDate,
        amortization_type: amortizationType,
        additional_costs_pct: parseFloat(extraCostsPct) || 0,
        additional_costs_label: extraCostsLabel.trim() || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['credits'] });
      toast({ title: 'Crédito creado' });
      reset();
      setOpen(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo crédito
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo crédito</DialogTitle>
            <DialogDescription>Registralo para llevarlo al día con tabla de amortización.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Nombre del crédito</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Bancolombia rotativa, Davivienda TC" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Banco/Entidad (opcional)</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ej: Bancolombia" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Monto inicial</Label>
              <Input type="number" min="0" step="1" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="70000000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tasa mensual (%)</Label>
              <Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="1.5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Plazo (meses)</Label>
              <Input type="number" min="1" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="36" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo amortización</Label>
              <Select value={amortizationType} onValueChange={(v) => setAmortizationType(v as AmortizationType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="francesa">Francesa (cuota fija)</SelectItem>
                  <SelectItem value="alemana">Alemana (capital fijo)</SelectItem>
                  <SelectItem value="bullet">Bullet (capital al final)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha desembolso</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">1ra cuota</Label>
              <Input type="date" value={firstPaymentDate} onChange={(e) => setFirstPaymentDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 col-span-2 pt-2 border-t">
              <Label className="text-xs">Costos asociados al crédito (opcional)</Label>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Cobros únicos del banco que se descuentan del desembolso o pagás aparte:
                seguro Fogafin, comisión de apertura, estudio de crédito, comisión de gestión.
                Estos costos reducen la rentabilidad real del préstamo — el banco te dice
                que prestó X pero en realidad recibís X menos los costos.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">% sobre el principal</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={extraCostsPct}
                onChange={(e) => setExtraCostsPct(e.target.value)}
                placeholder="Ej: 4.85"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">A qué corresponde</Label>
              <Input
                value={extraCostsLabel}
                onChange={(e) => setExtraCostsLabel(e.target.value)}
                placeholder="Ej: Seguro Fogafin"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Notas (opcional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          {previewCuota !== null && previewCuota > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              <div>
                <span className="text-muted-foreground">Cuota estimada {amortizationType === 'alemana' ? '(primera, decreciente)' : amortizationType === 'bullet' ? '(solo intereses, capital al final)' : ''}: </span>
                <span className="font-bold">{fmt(previewCuota)}</span>
              </div>
              {(() => {
                const p = parseFloat(principal) || 0;
                const extraCost = p * (parseFloat(extraCostsPct) || 0) / 100;
                if (extraCost <= 0) return null;
                const desembolsoEfectivo = p - extraCost;
                return (
                  <>
                    <div className="text-amber-700 dark:text-amber-400">
                      Costos adicionales: <span className="font-bold">{fmt(extraCost)}</span> ({parseFloat(extraCostsPct).toFixed(2)}% sobre el principal)
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Desembolso efectivo: {fmt(desembolsoEfectivo)} (recibís esto, pero las cuotas se calculan sobre el principal completo)
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Crear crédito'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
