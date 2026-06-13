import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useFinancialActuals, REPORT_GROUPS } from '@/hooks/useFinancialActuals';
import type { ReportGroup } from '@/types/transaction';

export interface BudgetRow {
  id: string;
  year: number;
  month: number;            // 1-12
  report_group: ReportGroup;
  amount_planned: number;
}

export interface BudgetVsActualGroup {
  group: ReportGroup;
  planned: number[];        // 12 meses
  actual: number[];         // 12 meses (del real)
  plannedTotal: number;
  actualTotal: number;
  /** desvío % anual: (real − plan) / plan × 100. null si plan = 0 */
  variancePct: number | null;
}

export interface BudgetVsActual {
  groups: BudgetVsActualGroup[];
  // Resultado (utilidad) planeado vs real
  resultPlanned: number[];
  resultActual: number[];
  resultPlannedTotal: number;
  resultActualTotal: number;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function useBudget(year: number) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const actualsQuery = useFinancialActuals(year);

  const budgetQuery = useQuery<BudgetRow[]>({
    queryKey: ['budgets', user?.id, year],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from('budgets' as never) as any)
        .select('*')
        .eq('year', year);
      if (error) throw error;
      return (((data as unknown) as BudgetRow[]) ?? []).map((r) => ({ ...r, amount_planned: num(r.amount_planned) }));
    },
  });

  // Mapa (group|month) → planeado
  const plannedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of budgetQuery.data ?? []) m.set(`${b.report_group}|${b.month}`, b.amount_planned);
    return m;
  }, [budgetQuery.data]);

  const comparison: BudgetVsActual | null = useMemo(() => {
    const actuals = actualsQuery.data;
    if (!actuals) return null;
    const groups: BudgetVsActualGroup[] = REPORT_GROUPS.map((g) => {
      const planned = new Array(12).fill(0).map((_, i) => plannedMap.get(`${g}|${i + 1}`) ?? 0);
      const actual = actuals.byGroup[g];
      const plannedTotal = planned.reduce((s, v) => s + v, 0);
      const actualTotal = actual.reduce((s, v) => s + v, 0);
      return {
        group: g, planned, actual, plannedTotal, actualTotal,
        variancePct: plannedTotal > 0 ? Math.round(((actualTotal - plannedTotal) / plannedTotal) * 1000) / 10 : null,
      };
    });
    // Resultado = ingresos − costos − gastos − impuestos (mismo criterio que el PYG).
    const sub = (a: number[], ...rest: number[][]) => a.map((v, i) => v - rest.reduce((s, arr) => s + arr[i], 0));
    const byG = (g: ReportGroup) => groups.find((x) => x.group === g)!;
    const resultPlanned = sub(byG('ingresos').planned, byG('costos_operacionales').planned, byG('gastos_operativos').planned, byG('impuestos').planned);
    const resultActual = sub(byG('ingresos').actual, byG('costos_operacionales').actual, byG('gastos_operativos').actual, byG('impuestos').actual);
    return {
      groups,
      resultPlanned,
      resultActual,
      resultPlannedTotal: resultPlanned.reduce((s, v) => s + v, 0),
      resultActualTotal: resultActual.reduce((s, v) => s + v, 0),
    };
  }, [actualsQuery.data, plannedMap]);

  const setBudget = useMutation({
    mutationFn: async (input: { group: ReportGroup; month: number; amount: number }) => {
      if (!user) throw new Error('No auth');
      // UNIQUE(user_id, year, month, report_group) pero el trigger reescribe
      // user_id → resolvemos el upsert a mano (buscar fila existente).
      const { data: existing, error: exErr } = await (supabase.from('budgets' as never) as any)
        .select('id')
        .eq('year', year).eq('month', input.month).eq('report_group', input.group)
        .maybeSingle();
      if (exErr) throw exErr;
      if (existing?.id) {
        const { error } = await (supabase.from('budgets' as never) as any)
          .update({ amount_planned: input.amount }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from('budgets' as never) as any)
          .insert({ user_id: user.id, year, month: input.month, report_group: input.group, amount_planned: input.amount });
        // Carrera: otra escritura insertó la misma (year,month,group) entre el
        // SELECT y el INSERT → violación de UNIQUE. Reintentamos como UPDATE.
        if (error && (error as { code?: string }).code === '23505') {
          const { data: row } = await (supabase.from('budgets' as never) as any)
            .select('id').eq('year', year).eq('month', input.month).eq('report_group', input.group).maybeSingle();
          if (row?.id) {
            const { error: upErr } = await (supabase.from('budgets' as never) as any)
              .update({ amount_planned: input.amount }).eq('id', row.id);
            if (upErr) throw upErr;
          }
        } else if (error) {
          throw error;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets', user?.id, year] }),
    onError: (e: Error) => toast.error(`Error guardando presupuesto: ${e.message}`),
  });

  // Copia el plan de un grupo a los 12 meses (reparte un total anual / 12).
  const setBudgetGroupYear = useMutation({
    mutationFn: async (input: { group: ReportGroup; annualAmount: number }) => {
      if (!user) throw new Error('No auth');
      const monthly = Math.round((input.annualAmount / 12) * 100) / 100;
      for (let month = 1; month <= 12; month++) {
        const { data: existing } = await (supabase.from('budgets' as never) as any)
          .select('id').eq('year', year).eq('month', month).eq('report_group', input.group).maybeSingle();
        if (existing?.id) {
          await (supabase.from('budgets' as never) as any).update({ amount_planned: monthly }).eq('id', existing.id);
        } else {
          await (supabase.from('budgets' as never) as any).insert({ user_id: user.id, year, month, report_group: input.group, amount_planned: monthly });
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budgets', user?.id, year] }); toast.success('Presupuesto anual repartido en 12 meses'); },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  });

  return {
    comparison,
    isLoading: budgetQuery.isLoading || actualsQuery.isLoading,
    hasBudget: (budgetQuery.data?.length ?? 0) > 0,
    plannedMap,
    setBudget,
    setBudgetGroupYear,
  };
}
