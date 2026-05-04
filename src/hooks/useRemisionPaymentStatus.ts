import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type CobroStatus = 'cobrada' | 'parcial' | 'sin_cobrar';

export interface RemisionPaymentSummary {
  remision_id: string;
  total_remision: number;
  total_pagado: number;
  status: CobroStatus;
  payments_count: number;
}

export interface RemisionesGerencialContext {
  byRemision: Map<string, RemisionPaymentSummary>;
  totalRemisiones: number;
  totalDIANFacturado: number;
  brechaPct: number;
  agingSinCobrar60d: { count: number; total: number };
}

/**
 * Para una lista de remisiones gerenciales, calcula:
 *   - Estado de cobro de cada una (cobrada / parcial / sin cobrar)
 *   - KPI global de brecha vs DIAN facturado del año
 *   - Aging "despachado sin cobrar > 60 días"
 */
export function useRemisionPaymentStatus(remisiones: any[], year: number) {
  const { user } = useAuth();
  const remisionIds = remisiones.map((r: any) => r.id);

  return useQuery<RemisionesGerencialContext>({
    queryKey: ['remision-payment-status', user?.id, year, remisionIds.join(',')],
    enabled: !!user?.id,
    queryFn: async () => {
      const empty: RemisionesGerencialContext = {
        byRemision: new Map(),
        totalRemisiones: 0,
        totalDIANFacturado: 0,
        brechaPct: 0,
        agingSinCobrar60d: { count: 0, total: 0 },
      };
      if (!user?.id || remisiones.length === 0) return empty;

      // Pagos vinculados a estas remisiones
      const { data: paymentsData } = await supabase
        .from('remision_payments' as never)
        .select('remision_id, amount_assigned')
        .in('remision_id', remisionIds);

      const paid = new Map<string, { total: number; count: number }>();
      for (const p of (paymentsData ?? []) as Array<{ remision_id: string; amount_assigned: number }>) {
        const cur = paid.get(p.remision_id) ?? { total: 0, count: 0 };
        cur.total += Number(p.amount_assigned) || 0;
        cur.count += 1;
        paid.set(p.remision_id, cur);
      }

      // Construir summary por remisión
      const byRemision = new Map<string, RemisionPaymentSummary>();
      let totalRemisionesValor = 0;
      const today = new Date();
      const cutoff60 = new Date(today.getTime() - 60 * 86400 * 1000);
      let aging60count = 0;
      let aging60total = 0;

      for (const r of remisiones) {
        const items = r.remision_items || [];
        const total = r.total_manual
          ? Number(r.total_manual)
          : items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
        const pagado = paid.get(r.id)?.total ?? 0;
        const count = paid.get(r.id)?.count ?? 0;

        let status: CobroStatus = 'sin_cobrar';
        if (total > 0) {
          if (pagado >= total - 0.01) status = 'cobrada';
          else if (pagado > 0) status = 'parcial';
        }

        byRemision.set(r.id, {
          remision_id: r.id,
          total_remision: total,
          total_pagado: pagado,
          status,
          payments_count: count,
        });

        totalRemisionesValor += total;

        const remDate = new Date(r.date);
        if (remDate < cutoff60 && status !== 'cobrada' && total > 0) {
          aging60count++;
          aging60total += total - pagado;
        }
      }

      // Total facturado DIAN del año (ventas confirmadas)
      const { data: dianInvs } = await supabase
        .from('invoices')
        .select('total_amount')
        .eq('type', 'venta')
        .eq('status', 'confirmed')
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);
      const totalDIANFacturado = (dianInvs ?? []).reduce(
        (s: number, i: { total_amount: number | null }) => s + Number(i.total_amount || 0),
        0
      );

      const brechaPct = totalRemisionesValor > 0
        ? Math.round(((totalRemisionesValor - totalDIANFacturado) / totalRemisionesValor) * 100)
        : 0;

      return {
        byRemision,
        totalRemisiones: totalRemisionesValor,
        totalDIANFacturado,
        brechaPct,
        agingSinCobrar60d: { count: aging60count, total: aging60total },
      };
    },
  });
}
