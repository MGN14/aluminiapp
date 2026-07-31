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
  /** 'cerrado' = inmutable. 'en_edicion' = reabierto por un admin: los
   *  movimientos siguen agrupados en este cierre pero vuelven a ser editables
   *  hasta que se guarde de nuevo. */
  status: 'cerrado' | 'en_edicion';
  /** Computado/declarado/diferencia POR CUENTA. Los cierres viejos (una sola
   *  bolsa) traen todo bajo 'efectivo' por el backfill de la migración. */
  saldos: Record<string, SaldoCuenta>;
}

/** Los cierres anteriores a la columna `saldos` no la traen: se les arma el
 *  desglose de una sola cuenta para que la UI no tenga que ramificar. */
function normalizarSaldos(
  raw: unknown,
  computedTotal: number,
  declaredTotal: number,
): Record<string, SaldoCuenta> {
  if (raw && typeof raw === 'object' && Object.keys(raw as object).length > 0) {
    const out: Record<string, SaldoCuenta> = {};
    for (const [k, v] of Object.entries(raw as Record<string, any>)) {
      out[k] = {
        computado: Number(v?.computado) || 0,
        declarado: Number(v?.declarado) || 0,
        diferencia: Number(v?.diferencia) || 0,
      };
    }
    return out;
  }
  return {
    efectivo: {
      computado: computedTotal,
      declarado: declaredTotal,
      diferencia: declaredTotal - computedTotal,
    },
  };
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
        // Cierres anteriores a la migración no traen status.
        status: c.status === 'en_edicion' ? 'en_edicion' : 'cerrado',
        saldos: normalizarSaldos(c.saldos, Number(c.computed_balance) || 0, Number(c.declared_balance) || 0),
      }));
    },
  });
}

/** Desglose del cierre por cuenta ('efectivo', 'nequi', …). */
export interface SaldoCuenta {
  computado: number;
  declarado: number;
  diferencia: number;
}

interface CloseInput {
  period_start: string;
  period_end: string;
  declared_balance: number;
  notes?: string;
  /** Saldo físico declarado por cuenta: { efectivo: 800000, nequi: 240000 }. */
  declarados_por_cuenta?: Record<string, number>;
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
        p_declarados_por_cuenta: input.declarados_por_cuenta ?? null,
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

/** Reabrir un cierre — admin-only (la función SQL valida is_admin).
 *  NO disuelve el cierre: lo pasa a 'en_edicion' y los movimientos siguen
 *  agrupados por closing_id, solo vuelven a ser editables. */
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

interface RecloseInput {
  closingId: string;
  declared_balance: number;
  notes?: string;
  declarados_por_cuenta?: Record<string, number>;
}

/** Guardar y volver a cerrar un cierre que estaba en edición. Absorbe los
 *  movimientos abiertos del período y recalcula saldo y diferencia. */
export function useReclosePettyCashClosing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecloseInput) => {
      const { data, error } = await (supabase as any).rpc('reclose_petty_cash_closing', {
        p_closing_id: input.closingId,
        p_declared_balance: input.declared_balance,
        p_notes: input.notes ?? null,
        p_declarados_por_cuenta: input.declarados_por_cuenta ?? null,
      });
      if (error) throw error;
      return data as { movements_count: number; movements_absorbed: number; difference: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash-closings', user?.id] });
      qc.invalidateQueries({ queryKey: ['petty-cash-movements', user?.id] });
    },
  });
}

/** Descartar el cierre por completo: suelta los movimientos y borra el
 *  registro. Es lo que antes hacía "Reabrir". */
export function useDiscardPettyCashClosing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (closingId: string) => {
      const { data, error } = await (supabase as any).rpc('discard_petty_cash_closing', {
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
