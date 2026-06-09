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

  // Pagos disponibles: ingresos bancarios (credit > 0) + cash_movements (ingreso).
  // Traemos TODOS y filtramos por cliente en el RENDER (no en la query): así el
  // toggle "Ver todos" es instantáneo y podemos mostrar CUÁNTOS pagos esconde el
  // filtro de cliente. Antes el pre-filtro vivía acá y escondía pagos sin avisar
  // → parecía que "no se podía agregar más de un pago a la remisión".
  const { data: payments = [] } = useQuery<PaymentOption[]>({
    queryKey: ['payments-for-remision', user?.id],
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
        id: b.id, kind: 'bank', date: b.date, amount: Number(b.credit) || 0,
        description: b.description || '—', responsible_id: b.responsible_id,
      }));
      const cash: PaymentOption[] = (cashRes.data ?? []).map((c: any) => ({
        id: c.id, kind: 'cash', date: c.date, amount: Number(c.amount) || 0,
        description: c.description || 'Movimiento en efectivo', responsible_id: c.responsible_id,
      }));
      return [...bank, ...cash].sort((a, b) => b.date.localeCompare(a.date));
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

  // Asignaciones de TODAS las remisiones del usuario, para saber qué pagos
  // ya están parcial o totalmente tomados en otra remisión. Sin esto el modal
  // mostraba como "disponible" un pago que el usuario ya había vinculado a
  // otra remisión, permitiendo doble vinculación.
  const { data: allAssignments = [] } = useQuery({
    queryKey: ['remision-payments-all', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data } = await supabase
        .from('remision_payments' as never)
        .select('payment_kind, payment_id, amount_assigned, remision_id')
        .eq('user_id', user!.id);
      return ((data ?? []) as unknown as Array<{ payment_kind: string; payment_id: string; amount_assigned: number; remision_id: string }>);
    },
  });

  const linkedKey = (kind: string, paymentId: string) => `${kind}:${paymentId}`;
  const linkedSet = new Set(linked.map((l) => linkedKey(l.payment_kind, l.payment_id)));
  const totalLinked = linked.reduce((s, l) => s + Number(l.amount_assigned || 0), 0);
  const remaining = Math.max(0, remisionTotal - totalLinked);

  // Mapa pago → monto ya asignado en OTRAS remisiones (excluye la actual).
  const usedElsewhereByPayment = new Map<string, number>();
  for (const a of allAssignments) {
    if (a.remision_id === remisionId) continue;
    const k = linkedKey(a.payment_kind, a.payment_id);
    usedElsewhereByPayment.set(k, (usedElsewhereByPayment.get(k) ?? 0) + Number(a.amount_assigned || 0));
  }

  const availableOf = (p: PaymentOption): number => {
    const usedElsewhere = usedElsewhereByPayment.get(linkedKey(p.kind, p.id)) ?? 0;
    return Math.max(0, p.amount - usedElsewhere);
  };

  // Filtro por cliente de la remisión (opt-in vía "Ver todos"). Los pagos en
  // efectivo suelen tener descripción genérica → no matchean al beneficiario,
  // por eso quedaban ocultos. Ahora se cuentan y se muestran con un toque.
  const benef = remisionBeneficiary?.trim().toLowerCase();
  const hasClientFilter = !!(remisionResponsibleId || remisionBeneficiary);
  const matchesClient = (p: PaymentOption) => {
    if (!hasClientFilter) return true;
    if (remisionResponsibleId && p.responsible_id === remisionResponsibleId) return true;
    if (benef && p.description.toLowerCase().includes(benef)) return true;
    return false;
  };

  // Base: excluye pagos 100% tomados por OTRAS remisiones. Los ya vinculados a
  // ESTA remisión siguen visibles (para desvincular), aunque no matcheen cliente.
  const passesBase = (p: PaymentOption) => {
    const isLinkedHere = linkedSet.has(linkedKey(p.kind, p.id));
    return isLinkedHere || availableOf(p) > 0;
  };
  const passesSearch = (p: PaymentOption) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.description.toLowerCase().includes(q) || p.date.includes(q);
  };
  const filteredPayments = payments.filter((p) => {
    if (!passesBase(p)) return false;
    const isLinkedHere = linkedSet.has(linkedKey(p.kind, p.id));
    if (!isLinkedHere && !showAll && !matchesClient(p)) return false;
    return passesSearch(p);
  });
  // Cuántos pagos disponibles esconde HOY el filtro de cliente (para el botón).
  const hiddenByClient = !showAll && hasClientFilter
    ? payments.filter((p) => passesBase(p) && !linkedSet.has(linkedKey(p.kind, p.id)) && !matchesClient(p) && passesSearch(p)).length
    : 0;

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
        // Tope = lo que queda disponible del pago (después de descontar lo ya
        // asignado a otras remisiones). Default: min(disponible, lo que falta
        // cobrar de esta remisión).
        const available = availableOf(p);
        if (available <= 0) {
          toast({
            title: 'Pago no disponible',
            description: 'Este pago ya está completamente vinculado a otra remisión.',
            variant: 'destructive',
          });
          return;
        }
        const customAmount = parseFloat(editingAmounts[p.id] ?? '');
        const amountToAssign = !isNaN(customAmount) && customAmount > 0
          ? Math.min(customAmount, available)
          : Math.min(available, remaining > 0 ? remaining : available);

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
      queryClient.invalidateQueries({ queryKey: ['remision-payments-all'] });
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
          {hasClientFilter && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {showAll
                  ? 'Mostrando TODOS los pagos disponibles'
                  : `Filtrando pagos de "${remisionBeneficiary || 'cliente de la remisión'}"`}
              </span>
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-primary hover:underline font-medium">
                {showAll ? 'Solo del cliente' : `Ver todos${hiddenByClient ? ` (+${hiddenByClient})` : ''}`}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 max-h-80">
          {filteredPayments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {hiddenByClient > 0 ? (
                <>
                  No hay pagos de este cliente.{' '}
                  <button type="button" onClick={() => setShowAll(true)} className="text-primary hover:underline font-medium">
                    Ver los {hiddenByClient} pagos de otros clientes
                  </button>
                </>
              ) : (
                'No hay pagos disponibles para vincular.'
              )}
            </div>
          ) : (
            filteredPayments.map((p) => {
              const isLinked = linkedSet.has(linkedKey(p.kind, p.id));
              const linkedAmount = linked.find((l) => l.payment_kind === p.kind && l.payment_id === p.id)?.amount_assigned;
              const usedElsewhere = usedElsewhereByPayment.get(linkedKey(p.kind, p.id)) ?? 0;
              const partiallyUsed = !isLinked && usedElsewhere > 0;
              return (
                <button
                  key={`${p.kind}-${p.id}`}
                  onClick={() => handleToggle(p)}
                  disabled={saving}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    isLinked
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                      : partiallyUsed
                      ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/60'
                      : 'border-border hover:bg-muted/50'
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
                        {partiallyUsed && (
                          <span className="ml-1.5 text-amber-700 dark:text-amber-400 font-medium">
                            · {formatCurrency(usedElsewhere)} ya en otra remisión
                          </span>
                        )}
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
                      {partiallyUsed && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                          disponible: {formatCurrency(p.amount - usedElsewhere)}
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
