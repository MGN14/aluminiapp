import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { parseLocalDate } from '@/lib/dateUtils';
import { isOperativo, type ReportGroup } from '@/types/transaction';
import { computeBreakeven, type BreakevenResult } from '@/lib/breakeven';

export type CostBehavior = 'fijo' | 'variable';

/** Comportamiento efectivo de una categoría: el seteado, o el inferido por
 *  grupo (costos operacionales = variable; gastos/impuestos = fijo). */
export function effectiveBehavior(reportGroup: ReportGroup | null, costBehavior: CostBehavior | null): CostBehavior {
  if (costBehavior) return costBehavior;
  return reportGroup === 'costos_operacionales' ? 'variable' : 'fijo';
}

export interface CategorySpend {
  id: string;
  name: string;
  reportGroup: ReportGroup;
  behavior: CostBehavior;
  isInferred: boolean;   // true si el comportamiento viene del default (no seteado)
  total: number;         // egreso acumulado del periodo
}

export interface BreakevenData {
  result: BreakevenResult;
  ventas: number;
  costosVariables: number;
  costosFijos: number;
  categories: CategorySpend[];  // categorías de egreso con su total, para clasificar
  monthsWithData: number;       // para promediar a mensual
}

export function useBreakeven(year: number) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<BreakevenData>({
    queryKey: ['breakeven-v1', user?.id, year],
    enabled: !!user,
    queryFn: async () => {
      const [txRes, catRes, pcRes, cmRes, cpRes] = await Promise.all([
        (supabase.from('transactions') as any)
          .select('date, amount, type, category_id, movement_nature, has_retefuente, retefuente_amount, has_reteica, reteica_amount')
          .is('deleted_at', null).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        supabase.from('categories').select('id, name, report_group, cost_behavior'),
        supabase.from('petty_cash_movements').select('date, amount, category_id, kind')
          .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        (supabase.from('cash_movements') as any).select('date, amount, type')
          .is('petty_cash_movement_id', null).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        // Interés de créditos: gasto FIJO que el PYG también cuenta.
        (supabase.from('credit_payments' as never) as any)
          .select('payment_date, interest_paid')
          .gte('payment_date', `${year}-01-01`).lte('payment_date', `${year}-12-31`),
      ]);
      if (txRes.error) throw txRes.error;

      const catInfo = new Map<string, { name: string; group: ReportGroup; behavior: CostBehavior | null }>();
      for (const c of (catRes.data ?? []) as unknown as Array<{ id: string; name: string; report_group: ReportGroup | null; cost_behavior: CostBehavior | null }>) {
        catInfo.set(c.id, { name: c.name, group: (c.report_group as ReportGroup) || 'otros', behavior: c.cost_behavior });
      }

      let ventas = 0;
      let retencionesTotal = 0;  // retefuente/reteica de tx no-impuesto (variable)
      const monthsSet = new Set<number>();
      // Acumuladores por categoría (solo egresos operativos).
      const byCat = new Map<string, CategorySpend>();
      const addSpend = (catId: string | null, abs: number, fallbackGroup: ReportGroup) => {
        const info = catId ? catInfo.get(catId) : null;
        const key = catId && info ? catId : `__sin_${fallbackGroup}`;
        const group = info?.group ?? fallbackGroup;
        const behavior = effectiveBehavior(group, info?.behavior ?? null);
        const cur = byCat.get(key) ?? {
          id: key, name: info?.name ?? 'Sin categoría', reportGroup: group,
          behavior, isInferred: !(info?.behavior), total: 0,
        };
        cur.total += abs;
        byCat.set(key, cur);
      };
      // Item sintético no editable (interés de créditos, retenciones).
      const addSynthetic = (id: string, name: string, behavior: CostBehavior, total: number) => {
        if (total <= 0) return;
        byCat.set(id, { id, name, reportGroup: behavior === 'fijo' ? 'gastos_operativos' : 'impuestos', behavior, isInferred: false, total });
      };

      for (const t of (txRes.data ?? []) as Array<{ date: string; amount: number | null; type: string | null; category_id: string | null; movement_nature: string | null; has_retefuente: boolean; retefuente_amount: number | null; has_reteica: boolean | null; reteica_amount: number | null }>) {
        if (!isOperativo(t.movement_nature)) continue;
        monthsSet.add(parseLocalDate(t.date).getMonth());
        const amt = Number(t.amount) || 0;
        const info = t.category_id ? catInfo.get(t.category_id) : null;
        // Fallback por t.type (igual que el PYG), no por el signo del monto.
        const group: ReportGroup = info?.group ?? (t.type === 'ingreso' ? 'ingresos' : t.type === 'egreso' ? 'gastos_operativos' : 'otros');
        if (group === 'ingresos') { ventas += Math.abs(amt); }
        else { addSpend(t.category_id, Math.abs(amt), group); }
        // Retenciones de transacciones no clasificadas como impuesto (mismo
        // criterio que useFinancialActuals/PYG): suman como costo variable.
        if (group !== 'impuestos') {
          if (t.has_retefuente && Number(t.retefuente_amount) > 0) retencionesTotal += Number(t.retefuente_amount);
          if (t.has_reteica && Number(t.reteica_amount) > 0) retencionesTotal += Number(t.reteica_amount);
        }
      }
      for (const p of (pcRes.data ?? []) as Array<{ date: string; amount: number | null; category_id: string | null; kind: string | null }>) {
        monthsSet.add(parseLocalDate(p.date).getMonth());
        const abs = Math.abs(Number(p.amount) || 0);
        if (p.kind === 'ingreso_efectivo') { ventas += abs; continue; }
        const group = (p.category_id ? catInfo.get(p.category_id)?.group : null) ?? 'gastos_operativos';
        addSpend(p.category_id, abs, group);
      }
      for (const cm of (cmRes.data ?? []) as Array<{ date: string; amount: number | null; type: string }>) {
        monthsSet.add(parseLocalDate(cm.date).getMonth());
        const abs = Math.abs(Number(cm.amount) || 0);
        if (cm.type === 'ingreso') ventas += abs;
        else if (cm.type === 'egreso') addSpend(null, abs, 'costos_operacionales');
      }
      // Interés de créditos (gasto fijo) — para cuadrar con el PYG.
      const interesTotal = ((cpRes.data ?? []) as Array<{ interest_paid: number | null }>)
        .reduce((s, c) => s + (Number(c.interest_paid) > 0 ? Number(c.interest_paid) : 0), 0);
      addSynthetic('__interes_creditos__', 'Interés de créditos', 'fijo', interesTotal);
      addSynthetic('__retenciones__', 'Retenciones (retefuente/ReteICA)', 'variable', retencionesTotal);

      const categories = Array.from(byCat.values()).sort((a, b) => b.total - a.total);
      const costosVariables = categories.filter((c) => c.behavior === 'variable').reduce((s, c) => s + c.total, 0);
      const costosFijos = categories.filter((c) => c.behavior === 'fijo').reduce((s, c) => s + c.total, 0);
      const result = computeBreakeven({ ventas, costosVariables, costosFijos });

      return { result, ventas, costosVariables, costosFijos, categories, monthsWithData: Math.max(1, monthsSet.size) };
    },
  });

  const setBehavior = useMutation({
    mutationFn: async ({ categoryId, behavior }: { categoryId: string; behavior: CostBehavior }) => {
      if (categoryId.startsWith('__')) return; // sintéticos / "Sin categoría" no editables
      const { error } = await supabase.from('categories').update({ cost_behavior: behavior } as never).eq('id', categoryId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['breakeven-v1', user?.id, year] }),
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  });

  return useMemo(() => ({ data: query.data, isLoading: query.isLoading, setBehavior }), [query.data, query.isLoading, setBehavior]);
}
