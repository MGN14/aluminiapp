import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { aggregateTrialBalance, aggregatePyg, type BalanceSection, type PnlAggregate } from '@/lib/pucClassify';

export interface TrialBalanceImportRow {
  account_code: string;
  account_name: string | null;
  saldo: number;
}

export interface ExternalTrialBalance {
  bySection: Record<BalanceSection, number>;
  pnl: PnlAggregate;
  /** fecha de corte del Balance (clases 1-3) */
  balanceSnapshotDate: string | null;
  /** fecha de corte del Estado de Resultados (clases 4-7) */
  pnlSnapshotDate: string | null;
  count: number;
  hasData: boolean;
  /** hay cuentas de balance (clases 1-3) cargadas */
  hasBalance: boolean;
  /** hay cuentas de resultado (clases 4-7) cargadas */
  hasPnl: boolean;
}

const BALANCE_CLASSES = ['1', '2', '3'];
const PNL_CLASSES = ['4', '5', '6', '7'];
const firstDigit = (c: string) => String(c ?? '').replace(/\D/g, '')[0] || '';

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
      const lines = rows.map((r) => ({ account_code: r.account_code, saldo: Number(r.saldo) || 0 }));
      // Fecha de corte POR GRUPO (balance vs resultados pueden importarse en
      // momentos/cortes distintos): max snapshot_date de cada grupo de clases.
      const maxSnap = (classes: string[]) => {
        const ds = rows.filter((r) => classes.includes(firstDigit(r.account_code)))
          .map((r) => r.snapshot_date).filter(Boolean) as string[];
        return ds.length ? ds.slice().sort().at(-1)! : null;
      };
      return {
        bySection: aggregateTrialBalance(lines),
        pnl: aggregatePyg(lines),
        balanceSnapshotDate: maxSnap(BALANCE_CLASSES),
        pnlSnapshotDate: maxSnap(PNL_CLASSES),
        count: rows.length,
        hasData: rows.length > 0,
        hasBalance: lines.some((l) => BALANCE_CLASSES.includes(firstDigit(l.account_code))),
        hasPnl: lines.some((l) => PNL_CLASSES.includes(firstDigit(l.account_code))),
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
        // Reemplazo POR GRUPO (Balance 1-3 vs Resultados 4-7), no por clase
        // individual: importar un Estado de Resultados que no trae clase 6 debe
        // borrar TODO el grupo de resultados viejo (incluida la clase 6 stale),
        // sin tocar el Balance. Si el batch toca un grupo, se limpia ese grupo
        // entero antes de quedar solo lo nuevo.
        const cls = new Set(payload.map((r) => firstDigit(r.account_code)).filter(Boolean));
        const clasesBorrar: string[] = [];
        if (BALANCE_CLASSES.some((c) => cls.has(c))) clasesBorrar.push(...BALANCE_CLASSES);
        if (PNL_CLASSES.some((c) => cls.has(c))) clasesBorrar.push(...PNL_CLASSES);
        let del = (supabase.from('external_trial_balance' as never) as any)
          .delete().not('id', 'in', `(${newIds.join(',')})`);
        if (clasesBorrar.length > 0) del = del.or(clasesBorrar.map((c) => `account_code.like.${c}%`).join(','));
        const { error: delErr } = await del;
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

  // group: 'balance' borra solo clases 1-3, 'pnl' solo 4-7 (no destruye el otro
  // comparativo). Sin group, borra todo (compat).
  const clearBalance = useMutation({
    mutationFn: async (group?: 'balance' | 'pnl') => {
      let del = (supabase.from('external_trial_balance' as never) as any).delete().not('id', 'is', null);
      const clases = group === 'balance' ? BALANCE_CLASSES : group === 'pnl' ? PNL_CLASSES : null;
      if (clases) del = del.or(clases.map((c) => `account_code.like.${c}%`).join(','));
      const { error } = await del;
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
