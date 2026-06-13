import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { aggregateTrialBalance, type BalanceSection } from '@/lib/pucClassify';

export interface TrialBalanceImportRow {
  account_code: string;
  account_name: string | null;
  saldo: number;
}

export interface ExternalTrialBalance {
  bySection: Record<BalanceSection, number>;
  snapshotDate: string | null;
  count: number;
  hasData: boolean;
}

export function useExternalTrialBalance() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<ExternalTrialBalance>({
    queryKey: ['external-trial-balance', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from('external_trial_balance' as never) as any)
        .select('account_code, saldo, snapshot_date');
      if (error) throw error;
      const rows = ((data as unknown) as Array<{ account_code: string; saldo: number; snapshot_date: string | null }>) ?? [];
      return {
        bySection: aggregateTrialBalance(rows.map((r) => ({ account_code: r.account_code, saldo: Number(r.saldo) || 0 }))),
        snapshotDate: rows[0]?.snapshot_date ?? null,
        count: rows.length,
        hasData: rows.length > 0,
      };
    },
  });

  const importBalance = useMutation({
    mutationFn: async (input: { rows: TrialBalanceImportRow[]; snapshotDate: string | null }) => {
      if (!user) throw new Error('No auth');
      const payload = input.rows
        .filter((r) => r.account_code.trim() !== '')
        .map((r) => ({
          user_id: user.id, // el trigger lo reescribe al data owner
          account_code: r.account_code.trim(),
          account_name: r.account_name?.trim() || null,
          saldo: Number(r.saldo) || 0,
          snapshot_date: input.snapshotDate,
          source: 'siigo',
        }));
      if (payload.length === 0) throw new Error('No hay filas válidas para importar');

      // Snapshot reemplazable, SIN dejar vacío si algo falla: insertamos lo
      // nuevo PRIMERO y solo si sale bien borramos lo anterior (las filas que
      // no son del batch recién insertado). Si el insert falla, el snapshot
      // viejo queda intacto. (RLS current_data_owner acota todo al owner.)
      const { data: inserted, error: insErr } = await (supabase.from('external_trial_balance' as never) as any)
        .insert(payload).select('id');
      if (insErr) throw insErr;
      const newIds = ((inserted as Array<{ id: string }>) ?? []).map((r) => r.id);
      if (newIds.length > 0) {
        const { error: delErr } = await (supabase.from('external_trial_balance' as never) as any)
          .delete().not('id', 'in', `(${newIds.join(',')})`);
        if (delErr) throw delErr; // quedan duplicadas (no vacío); el usuario reintenta
      }
      return payload.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['external-trial-balance', user?.id] });
      toast.success(`Balance de prueba importado: ${n} cuentas`);
    },
    onError: (e: Error) => toast.error(`Error importando: ${e.message}`),
  });

  const clearBalance = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from('external_trial_balance' as never) as any).delete().not('id', 'is', null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['external-trial-balance', user?.id] });
      toast.success('Balance de prueba borrado');
    },
    onError: (e: Error) => toast.error(`No se pudo borrar: ${e.message}`),
  });

  return useMemo(() => ({
    data: query.data,
    isLoading: query.isLoading,
    importBalance,
    clearBalance,
  }), [query.data, query.isLoading, importBalance, clearBalance]);
}
