import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PettyCashClosing {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  movements_count: number;
  computed_balance: number;
  declared_balance: number;
  difference: number;
  notes: string | null;
  closed_at: string;
  created_at: string;
}

export function usePettyCashClosings() {
  const { user } = useAuth();
  return useQuery<PettyCashClosing[]>({
    queryKey: ['petty-cash-closings', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('petty_cash_closings' as never)
        .select('*')
        .eq('user_id', user!.id)
        .order('period_end', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as PettyCashClosing[]).map((c) => ({
        ...c,
        movements_count: Number(c.movements_count) || 0,
        computed_balance: Number(c.computed_balance) || 0,
        declared_balance: Number(c.declared_balance) || 0,
        difference: Number(c.difference) || 0,
      }));
    },
  });
}

interface CloseInput {
  period_start: string;
  period_end: string;
  declared_balance: number;
  notes?: string;
}

export function useClosePettyCashPeriod() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CloseInput) => {
      if (!user?.id) throw new Error('No user');
      const { data, error } = await (supabase as any).rpc('close_petty_cash_period', {
        p_user_id: user.id,
        p_period_start: input.period_start,
        p_period_end: input.period_end,
        p_declared_balance: input.declared_balance,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash-closings', user?.id] });
      qc.invalidateQueries({ queryKey: ['petty-cash-movements', user?.id] });
    },
  });
}

/** Reabrir un cierre — admin-only (la función SQL valida is_admin). */
export function useReopenPettyCashClosing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (closingId: string) => {
      const { data, error } = await (supabase as any).rpc('reopen_petty_cash_closing', {
        p_closing_id: closingId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash-closings', user?.id] });
      qc.invalidateQueries({ queryKey: ['petty-cash-movements', user?.id] });
    },
  });
}
