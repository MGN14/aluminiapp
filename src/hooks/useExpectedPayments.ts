import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface ExpectedPayment {
  id: string;
  invoice_id: string | null;
  responsible_id: string | null;
  due_date: string;
  amount: number;
  status: 'pendiente' | 'cumplido' | 'cancelado';
  notes: string | null;
  paid_at: string | null;
  created_at: string;
  // Joined / computed:
  responsible_name: string | null;
  invoice_number: string | null;
  is_overdue: boolean;
  days_until: number;
}

export interface ExpectedPaymentsSummary {
  all: ExpectedPayment[];
  proximos_7d: ExpectedPayment[];
  proximos_30d: ExpectedPayment[];
  vencidos: ExpectedPayment[];
  total_7d: number;
  total_30d: number;
  total_vencido: number;
  total_pendiente: number;
}

const todayIso = (): string => new Date().toISOString().split('T')[0];

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

/**
 * Hook para gestionar cobros esperados (promesas de pago de clientes).
 *
 * Trae todas las promesas pendientes + un poco de contexto (nombre del
 * cliente, número de factura), y expone mutaciones para crear / marcar
 * cumplido / cancelar / borrar.
 */
export function useExpectedPayments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery<ExpectedPaymentsSummary>({
    queryKey: ['expected-payments', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const empty: ExpectedPaymentsSummary = {
        all: [], proximos_7d: [], proximos_30d: [], vencidos: [],
        total_7d: 0, total_30d: 0, total_vencido: 0, total_pendiente: 0,
      };
      if (!user) return empty;

      // Bulk: cobros esperados + responsibles + invoices para enriquecer.
      const [paymentsRes, responsiblesRes, invoicesRes] = await Promise.all([
        supabase
          .from('expected_payments' as never)
          .select('id, invoice_id, responsible_id, due_date, amount, status, notes, paid_at, created_at')
          .eq('status', 'pendiente'),
        supabase.from('responsibles').select('id, name'),
        supabase.from('invoices').select('id, invoice_number'),
      ]);

      if (paymentsRes.error) throw paymentsRes.error;
      if (responsiblesRes.error) throw responsiblesRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      const responsibleNames = new Map(
        (responsiblesRes.data ?? []).map(r => [r.id, r.name]),
      );
      const invoiceNumbers = new Map(
        (invoicesRes.data ?? []).map(i => [i.id, i.invoice_number]),
      );

      const today = todayIso();
      const raw = ((paymentsRes.data as unknown) as Array<{
        id: string;
        invoice_id: string | null;
        responsible_id: string | null;
        due_date: string;
        amount: number;
        status: 'pendiente' | 'cumplido' | 'cancelado';
        notes: string | null;
        paid_at: string | null;
        created_at: string;
      }>) ?? [];

      const enriched: ExpectedPayment[] = raw.map(p => {
        const daysUntil = daysBetween(today, p.due_date);
        return {
          ...p,
          amount: Number(p.amount) || 0,
          responsible_name: p.responsible_id ? (responsibleNames.get(p.responsible_id) ?? null) : null,
          invoice_number: p.invoice_id ? (invoiceNumbers.get(p.invoice_id) ?? null) : null,
          is_overdue: daysUntil < 0,
          days_until: daysUntil,
        };
      });

      // Orden: vencidos primero (más viejos arriba), después próximos por
      // fecha asc.
      enriched.sort((a, b) => a.due_date.localeCompare(b.due_date));

      const proximos_7d = enriched.filter(p => p.days_until >= 0 && p.days_until <= 7);
      const proximos_30d = enriched.filter(p => p.days_until >= 0 && p.days_until <= 30);
      const vencidos = enriched.filter(p => p.is_overdue);

      return {
        all: enriched,
        proximos_7d,
        proximos_30d,
        vencidos,
        total_7d: proximos_7d.reduce((s, p) => s + p.amount, 0),
        total_30d: proximos_30d.reduce((s, p) => s + p.amount, 0),
        total_vencido: vencidos.reduce((s, p) => s + p.amount, 0),
        total_pendiente: enriched.reduce((s, p) => s + p.amount, 0),
      };
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expected-payments', user?.id] });

  // Crear una nueva promesa de pago.
  const create = useMutation({
    mutationFn: async (input: {
      invoice_id?: string | null;
      responsible_id?: string | null;
      due_date: string;
      amount: number;
      notes?: string | null;
    }) => {
      if (!user) throw new Error('No auth');
      const { error } = await supabase.from('expected_payments' as never).insert({
        user_id: user.id,
        invoice_id: input.invoice_id ?? null,
        responsible_id: input.responsible_id ?? null,
        due_date: input.due_date,
        amount: input.amount,
        notes: input.notes ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Cobro acordado', description: 'Aparecerá en el dashboard y en el calendario.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    },
  });

  // Marcar como cumplido (recibí el pago).
  const markCumplido = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('expected_payments' as never)
        .update({ status: 'cumplido', paid_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Cobro marcado como cumplido' });
    },
  });

  // Cancelar la promesa (no se cobró / se renegoció).
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('expected_payments' as never)
        .update({ status: 'cancelado' } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Cobro cancelado' });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('expected_payments' as never)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Cobro eliminado' });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    create,
    markCumplido,
    cancel,
    remove,
  };
}
