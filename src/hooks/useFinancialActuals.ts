import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parseLocalDate } from '@/lib/dateUtils';
import { isOperativo, type ReportGroup } from '@/types/transaction';

/**
 * "Real" del Estado de Resultados por grupo y por mes, calculado con la MISMA
 * fórmula que PYGReport.buildMonthlyData (debe mantenerse en sync):
 *  - solo movimientos operativos (isOperativo)
 *  - grupo = categoría.report_group; sin categoría → ingreso/gasto por tipo
 *  - petty cash incluido (vista gerencial): ingreso_efectivo suma a ingresos
 *  - interés de créditos como gasto operativo
 *  - retefuente/reteica de transacciones no-impuesto suman a impuestos
 *
 * Reutilizado por Presupuesto vs Real y por la utilidad del Balance.
 */

const GROUPS: ReportGroup[] = ['ingresos', 'costos_operacionales', 'gastos_operativos', 'impuestos', 'otros'];

export interface FinancialActuals {
  /** Por grupo: 12 valores (uno por mes), en valor absoluto. */
  byGroup: Record<ReportGroup, number[]>;
  /** Utilidad neta por mes = ingresos − costos − gastos − impuestos. */
  utilidadMensual: number[];
  totalByGroup: Record<ReportGroup, number>;
  utilidadAnual: number;
}

function emptyByGroup(): Record<ReportGroup, number[]> {
  return {
    ingresos: new Array(12).fill(0),
    costos_operacionales: new Array(12).fill(0),
    gastos_operativos: new Array(12).fill(0),
    impuestos: new Array(12).fill(0),
    otros: new Array(12).fill(0),
  };
}

export function useFinancialActuals(year: number) {
  const { user } = useAuth();

  return useQuery<FinancialActuals>({
    queryKey: ['financial-actuals-v1', user?.id, year],
    enabled: !!user,
    queryFn: async () => {
      const byGroup = emptyByGroup();

      const [txRes, catRes, pcRes, cpRes, cmRes] = await Promise.all([
        (supabase.from('transactions') as any)
          .select('date, amount, type, category_id, has_retefuente, retefuente_amount, has_reteica, reteica_amount, movement_nature')
          .is('deleted_at', null)
          .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        supabase.from('categories').select('id, report_group'),
        supabase.from('petty_cash_movements').select('date, amount, category_id, kind')
          .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        (supabase.from('credit_payments' as never) as any)
          .select('payment_date, interest_paid')
          .gte('payment_date', `${year}-01-01`).lte('payment_date', `${year}-12-31`),
        // cash_movements nativos (vista gerencial): ingreso→ingresos, egreso→costos.
        // Excluimos los promovidos desde caja menor (ya contados vía petty).
        (supabase.from('cash_movements') as any)
          .select('date, amount, type').is('petty_cash_movement_id', null)
          .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
      ]);
      if (txRes.error) throw txRes.error;

      const catGroup = new Map<string, ReportGroup>();
      for (const c of (catRes.data ?? []) as Array<{ id: string; report_group: ReportGroup | null }>) {
        catGroup.set(c.id, (c.report_group as ReportGroup) || 'otros');
      }

      // Transacciones bancarias.
      for (const tx of (txRes.data ?? []) as Array<{
        date: string; amount: number | null; type: string | null; category_id: string | null;
        has_retefuente: boolean; retefuente_amount: number | null;
        has_reteica: boolean | null; reteica_amount: number | null; movement_nature: string | null;
      }>) {
        if (!isOperativo(tx.movement_nature)) continue;
        const m = parseLocalDate(tx.date).getMonth();
        const abs = Math.abs(Number(tx.amount) || 0);
        const rg: ReportGroup = tx.category_id && catGroup.has(tx.category_id)
          ? catGroup.get(tx.category_id)!
          : (tx.type === 'ingreso' ? 'ingresos' : tx.type === 'egreso' ? 'gastos_operativos' : 'otros');
        byGroup[rg][m] += abs;
        if (rg !== 'impuestos') {
          if (tx.has_retefuente && Number(tx.retefuente_amount) > 0) byGroup.impuestos[m] += Number(tx.retefuente_amount);
          if (tx.has_reteica && Number(tx.reteica_amount) > 0) byGroup.impuestos[m] += Number(tx.reteica_amount);
        }
      }

      // Petty cash (vista gerencial).
      for (const p of (pcRes.data ?? []) as Array<{ date: string; amount: number | null; category_id: string | null; kind: string | null }>) {
        const m = parseLocalDate(p.date).getMonth();
        const abs = Math.abs(Number(p.amount) || 0);
        if (p.kind === 'ingreso_efectivo') {
          byGroup.ingresos[m] += abs;
        } else {
          const rg: ReportGroup = p.category_id && catGroup.has(p.category_id) ? catGroup.get(p.category_id)! : 'gastos_operativos';
          byGroup[rg][m] += abs;
        }
      }

      // Interés de créditos = gasto operativo.
      for (const cp of (cpRes.data ?? []) as Array<{ payment_date: string; interest_paid: number | null }>) {
        const interest = Number(cp.interest_paid) || 0;
        if (interest <= 0) continue;
        const m = parseLocalDate(cp.payment_date).getMonth();
        byGroup.gastos_operativos[m] += interest;
      }

      // cash_movements nativos (mismo criterio que PYGReport en Gerencial).
      for (const cm of (cmRes.data ?? []) as Array<{ date: string; amount: number | null; type: string }>) {
        const m = parseLocalDate(cm.date).getMonth();
        const abs = Math.abs(Number(cm.amount) || 0);
        if (cm.type === 'ingreso') byGroup.ingresos[m] += abs;
        else if (cm.type === 'egreso') byGroup.costos_operacionales[m] += abs;
      }

      const totalByGroup = {} as Record<ReportGroup, number>;
      for (const g of GROUPS) totalByGroup[g] = byGroup[g].reduce((s, v) => s + v, 0);

      const utilidadMensual = new Array(12).fill(0).map((_, m) =>
        byGroup.ingresos[m] - byGroup.costos_operacionales[m] - byGroup.gastos_operativos[m] - byGroup.impuestos[m],
      );
      const utilidadAnual = utilidadMensual.reduce((s, v) => s + v, 0);

      return { byGroup, utilidadMensual, totalByGroup, utilidadAnual };
    },
  });
}

export { GROUPS as REPORT_GROUPS };
