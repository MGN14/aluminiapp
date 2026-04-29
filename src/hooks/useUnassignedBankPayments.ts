import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface BankPayment {
  id: string;
  date: string;
  description: string;
  credit: number;
  /** Beneficiario para Cartera Operativa (independiente del de DIAN). */
  operative_responsible_id: string | null;
  operative_responsible_name: string | null;
}

const DEFAULT_LOOKBACK_DAYS = 90;

function lookbackIsoDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchPayments(opts: {
  userId: string;
  assigned: boolean;
  lookbackDays?: number;
}): Promise<BankPayment[]> {
  const { userId, assigned, lookbackDays = DEFAULT_LOOKBACK_DAYS } = opts;

  // "Sin asignar" = misma fuente que Pendientes del Dashboard:
  // transacciones con responsible_id NULL (no conciliadas a DIAN), credit > 0 (ingresos).
  // "Asignados" = operative_receivable_assigned = true, sin importar responsible_id.
  let query = supabase
    .from('transactions')
    .select('id, date, description, credit, operative_responsible_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gt('credit', 0)
    .gte('date', lookbackIsoDate(lookbackDays))
    .order('date', { ascending: false });

  if (assigned) {
    query = query.eq('operative_receivable_assigned', true);
  } else {
    query = query
      .is('responsible_id', null)
      .eq('operative_receivable_assigned', false);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    date: string;
    description: string | null;
    credit: number | null;
    operative_responsible_id: string | null;
  }>;

  const responsibleIds = Array.from(
    new Set(rows.map((r) => r.operative_responsible_id).filter((id): id is string => !!id))
  );

  const nameById = new Map<string, string>();
  if (responsibleIds.length > 0) {
    const { data: respData } = await supabase
      .from('responsibles')
      .select('id, name')
      .in('id', responsibleIds);
    for (const r of respData ?? []) nameById.set(r.id, r.name);
  }

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    description: r.description ?? '',
    credit: Number(r.credit) || 0,
    operative_responsible_id: r.operative_responsible_id,
    operative_responsible_name: r.operative_responsible_id
      ? nameById.get(r.operative_responsible_id) ?? null
      : null,
  }));
}

export function useUnassignedBankPayments(lookbackDays?: number) {
  const { user } = useAuth();
  return useQuery<BankPayment[]>({
    queryKey: ['unassigned-bank-payments', user?.id, lookbackDays ?? DEFAULT_LOOKBACK_DAYS],
    enabled: !!user?.id,
    queryFn: () => fetchPayments({ userId: user!.id, assigned: false, lookbackDays }),
  });
}

export function useAssignedOperativePayments(lookbackDays?: number) {
  const { user } = useAuth();
  return useQuery<BankPayment[]>({
    queryKey: ['assigned-operative-payments', user?.id, lookbackDays ?? DEFAULT_LOOKBACK_DAYS],
    enabled: !!user?.id,
    queryFn: () => fetchPayments({ userId: user!.id, assigned: true, lookbackDays }),
  });
}
