import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, Banknote, Landmark, CheckCircle, X, AlertCircle } from 'lucide-react';

interface Props {
  remisionId: string;
  remisionNumber: string;
  remisionResponsibleId: string | null;
  remisionBeneficiary: string | null;
  remisionTotal: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaymentOption {
  id: string;
  kind: 'bank' | 'cash';
  date: string;
  amount: number;
  description: string;
  responsible_id: string | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function VincularPagoRemisionModal({
  remisionId,
  remisionNumber,
  remisionResponsibleId,
  remisionBeneficiary,
  remisionTotal,
  open,
  onOpenChange,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingAmounts, setEditingAmounts] = useState<Record<string, string>>({});

  // Pagos disponibles: ingresos bancarios (credit > 0) + cash_movements (ingreso)
  const { data: payments = [] } = useQuery<PaymentOption[]>({
    queryKey: ['payments-for-remision', user?.id, remisionResponsibleId, showAll],
    enabled: !!user?.id && open,
    queryFn: async () => {
      if (!user?.id) return [];

      const [bankRes, cashRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, date, description, credit, responsible_id')
          .is('deleted_at', null)
          .gt('credit', 0)
          .order('date', { ascending: false })
          .limit(200),
        supabase
          .from('cash_movements')
          .select('id, date, amount, description, responsible_id, type')
          .eq('type', 'ingreso')
          .order('date', { ascending: false })
          .limit(200),
      ]);

      const bank: PaymentOption[] = (bankRes.data ?? []).map((b: any) => ({
        id: b.id,
        kind: 'bank',
        date: b.date,
        amount: Number(b.credit) || 0,
        description: b.description || '—',
        responsible_id: b.responsible_id,
      }));
      const cash: PaymentOption[] = (cashRes.data ?? []).map((c: any) => ({
        id: c.id,
        kind: 'cash',
        date: c.date,
        amount: Number(c.amount) || 0,
        description: c.description || 'Movimiento en efectivo',
        responsible_id: c.responsible_id,
      }));
      const all = [...bank, ...cash].sort((a, b) => b.date.localeCompare(a.date));

      // Pre-filtro por cliente de la remision
      if (showAll || (!remisionResponsibleId && !remisionBeneficiary)) return all;
      const benef = remisionBeneficiary?.trim().toLowerCase();
      return all.filter((p) => {
        if (remisionResponsibleId && p.responsible_id === remisionResponsibleId) return true;
        if (benef && p.description.toLowerCase().includes(benef)) return true;
        return false;
      });
    },
  });

  // Pagos ya vinculados a esta remisión
  const { data: linked = [] } = useQuery({
    queryKey: ['remision-payments-linked', remisionId],
    enabled: !!remisionId && open,
    queryFn: async () => {
      const { data } = await supabase
        .from('remision_payments' as never)
        .select('id, payment_kind, payment_id, amount_assigned')
        .eq('remision_id', remisionId);
      return ((data ?? []) as unknown as Array<{ id: string; payment_kind: string; payment_id: string; amount_assigned: number }>);
    },
  });

  const linkedKey = (kind: string, paymentId: string) => `${kind}:${paymentId}`;
  const linkedSet = new Set(linked.map((l) => linkedKey(l.payment_kind, l.payment_id)));
  const totalLinked = linked.reduce((s, l) => s + Number(l.amount_assigned || 0), 0);
  const remaining = Math.max(0, remisionTotal - totalLinked);

  const filteredPayments = payments.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.description.toLowerCase().includes(q) || p.date.includes(q);
  });

  const handleToggle = async (p: PaymentOption) => {
    if (!user?.id) return;
    const isLinked = linkedSet.has(linkedKey(p.kind, p.id));
    setSaving(true);
    try {
      if (isLinked) {
        const link = linked.find((l) => l.payment_kind === p.kind && l.payment_id === p.id);
        if (link) {
          await (supabase.from('remision_payments' as never) as any)
            .delete()
            .eq('id', link.id);
        }
        toast({ title: 'Pago desvinculado' });
      } else {
        // Default: amount_assigned = min(monto del pago, lo que falta cobrar)
        const customAmount = parseFloat(editingAmounts[p.id] ?? '');
        const amountToAssign = !isNaN(customAmount) && customAmount > 0
          ? Math.min(customAmount, p.amount)
          : Math.min(p.amount, remaining > 0 ? remaining : p.amount);

        const { error } = await (supabase.from('remision_payments' as never) as any)
          .insert({
            user_id: user.id,
            remision_id: remisionId,
            payment_kind: p.kind,
            payment_id: p.id,
            amount_assigned: amountToAssign,
          });
        if (error && error.code !== '23505') throw error;
        toast({ title: 'Pago vinculado' });
      }
      queryClient.invalidateQueries({ queryKey: ['remision-payments-linked'] });
      queryClient.invalidateQueries({ queryKey: ['remision-payment-status'] });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Vincular pagos a {remisionNumber}</DialogTitle>
        </DialogHeader>

        {/* Resumen */}
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="rounded-lg border p-2 bg-muted/30">
            <span className="text-muted-foreground">Total remisión</span>
            <p className="font-bold">{formatCurrency(remisionTotal)}</p>
          </div>
          <div className="rounded-lg border p-2 bg-success/10">
            <span className="text-muted-foreground">Cobrado</span>
            <p className="font-bold text-success">{formatCurrency(totalLinked)}</p>
          </div>
          <div className="rounded-lg border p-2 bg-amber-50 dark:bg-amber-950/20">
            <span className="text-muted-foreground">Falta cobrar</span>
            <p className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(remaining)}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por concepto o fecha..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {(remisionResponsibleId || remisionBeneficiary) && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {showAll
                  ? 'Mostrando TODOS los pagos disponibles'
                  : `Filtrando pagos de "${remisionBeneficiary || 'cliente de la remisión'}"`}
              </span>
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-primary hover:underline">
                {showAll ? 'Solo del cliente' : 'Ver todos'}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 max-h-80">
          {filteredPayments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No hay pagos disponibles para vincular.
            </div>
          ) : (
            filteredPayments.map((p) => {
              const isLinked = linkedSet.has(linkedKey(p.kind, p.id));
              const linkedAmount = linked.find((l) => l.payment_kind === p.kind && l.payment_id === p.id)?.amount_assigned;
              return (
                <button
                  key={`${p.kind}-${p.id}`}
                  onClick={() => handleToggle(p)}
                  disabled={saving}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    isLinked ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {p.kind === 'bank' ? (
                      <Landmark className="h-4 w-4 shrink-0 text-blue-500" />
                    ) : (
                      <Banknote className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.date)} · {p.kind === 'bank' ? 'Banco' : 'Efectivo'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(p.amount)}</p>
                      {isLinked && linkedAmount !== undefined && Number(linkedAmount) !== p.amount && (
                        <p className="text-[10px] text-muted-foreground">
                          asignado: {formatCurrency(Number(linkedAmount))}
                        </p>
                      )}
                    </div>
                    {isLinked ? <CheckCircle className="h-4 w-4 text-green-500" /> : <span className="w-4" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {linked.length > 0 ? `Listo (${linked.length} vinculado${linked.length > 1 ? 's' : ''})` : 'Cerrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
