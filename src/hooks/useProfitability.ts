import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getYearRange } from '@/lib/dateUtils';
import { refFamilyKey } from '@/lib/refFamily';
import { computeProfitability, type SaleLine, type ProfitabilityResult } from '@/lib/profitability';

/** IVA estándar de las ventas de aluminio — los precios de remisión lo incluyen. */
const IVA_REMISION = 0.19;

export type ProfitSource = 'facturas' | 'remisiones';

interface ItemRow {
  reference: string | null;
  quantity: number | null;
  line_base: number | null;
  invoices: {
    void_type: string | null;
    voided_amount: number | null;
    total_amount: number | null;
    responsible_id: string | null;
    counterparty_name: string | null;
  };
}

/** Costos del inventario: por referencia exacta + por familia -5 (fallback
 *  para las remisiones, que despachan con sufijo de color LIV-40-3 mientras
 *  el inventario Siigo cuesta la familia LIV-40-5). */
async function fetchCostMaps() {
  const { data } = await supabase
    .from('inventory_products')
    .select('reference, cost_per_unit, active')
    .order('active', { ascending: false });
  const costByRef = new Map<string, number>();
  const costByFamily = new Map<string, number>();
  for (const p of ((data ?? []) as Array<{ reference: string | null; cost_per_unit: number }>)) {
    if (!p.reference) continue;
    const k = p.reference.trim().toLowerCase();
    if (!costByRef.has(k)) costByRef.set(k, Number(p.cost_per_unit) || 0);
    const fam = refFamilyKey(p.reference);
    if (fam && !costByFamily.has(fam)) costByFamily.set(fam, Number(p.cost_per_unit) || 0);
  }
  return { costByRef, costByFamily };
}

/**
 * Rentabilidad por referencia y por cliente del año.
 *
 * source = 'facturas' (default): líneas de factura de venta confirmadas
 * (ingreso = base sin IVA) — la vista DIAN.
 * source = 'remisiones': lo REALMENTE despachado con el precio de la remisión
 * (que viene con IVA → se divide por 1.19) — la vista gerencial, por variante
 * de color, cruzada contra el costo del kardex por familia.
 */
export function useProfitability(year: number, source: ProfitSource = 'facturas') {
  const { user } = useAuth();

  return useQuery<ProfitabilityResult>({
    queryKey: ['profitability-v2', user?.id, year, source],
    enabled: !!user,
    queryFn: async () => {
      const { start, end } = getYearRange(year);

      if (source === 'remisiones') {
        const PAGE = 1000;
        interface RemItem { reference: string; units: number; unit_cost: number; remisiones: { beneficiary: string | null; status: string | null } }
        const items: RemItem[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await (supabase.from('remision_items') as any)
            .select('reference, units, unit_cost, remisiones!inner(beneficiary, status, date, remision_type)')
            .eq('remisiones.remision_type', 'venta')
            .neq('remisiones.status', 'cancelado')
            .gte('remisiones.date', start)
            .lte('remisiones.date', end)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as RemItem[];
          items.push(...batch);
          if (batch.length < PAGE) break;
        }

        const { costByRef, costByFamily } = await fetchCostMaps();
        // Resolver costo para las refs despachadas (con sufijo de color):
        // exacta primero, familia -5 como fallback — sin esto casi ninguna
        // remisión cruzaba con el costo del inventario.
        for (const it of items) {
          const k = (it.reference ?? '').trim().toLowerCase();
          if (!k || costByRef.has(k)) continue;
          const famCost = costByFamily.get(refFamilyKey(it.reference));
          if (famCost !== undefined) costByRef.set(k, famCost);
        }

        const lines: SaleLine[] = items.map((it) => {
          const name = (it.remisiones?.beneficiary ?? '').trim() || 'Sin identificar';
          return {
            reference: it.reference ?? '',
            quantity: Number(it.units) || 0,
            // Precio de remisión CON IVA → base sin IVA para comparar contra
            // el costo del kardex (que no incluye el IVA descontable).
            ingreso: ((Number(it.unit_cost) || 0) * (Number(it.units) || 0)) / (1 + IVA_REMISION),
            clientKey: name.toLowerCase(),
            clientName: name,
          };
        });
        return computeProfitability(lines, costByRef);
      }

      // Paginar: PostgREST limita a 1000 filas por respuesta. Sin esto, una
      // cuenta con muchas líneas truncaría silenciosamente y corromper­ía los
      // márgenes. Acumulamos en páginas de 1000.
      const PAGE = 1000;
      const items: ItemRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase.from('invoice_items') as any)
          .select('reference, quantity, line_base, invoices!inner(void_type, voided_amount, total_amount, responsible_id, counterparty_name)')
          .eq('invoices.type', 'venta')
          .eq('invoices.status', 'confirmed')
          .gte('invoices.issue_date', start)
          .lte('invoices.issue_date', end)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as ItemRow[];
        items.push(...batch);
        if (batch.length < PAGE) break;
      }

      const [prodRes, respRes] = await Promise.all([
        // Sin filtro active: el costo de un producto inactivo sigue siendo
        // válido para costear ventas pasadas. Si hay reference duplicada,
        // gana el activo (se ordena active primero y solo se setea una vez).
        supabase.from('inventory_products').select('reference, cost_per_unit, active').order('active', { ascending: false }),
        supabase.from('responsibles').select('id, name'),
      ]);

      const costByRef = new Map<string, number>();
      for (const p of ((prodRes.data ?? []) as Array<{ reference: string | null; cost_per_unit: number }>)) {
        if (!p.reference) continue;
        const k = p.reference.trim().toLowerCase();
        if (!costByRef.has(k)) costByRef.set(k, Number(p.cost_per_unit) || 0);
      }
      const respName = new Map<string, string>();
      for (const r of ((respRes.data ?? []) as Array<{ id: string; name: string }>)) respName.set(r.id, r.name);

      const lines: SaleLine[] = items
        // Excluir facturas anuladas totalmente por nota crédito (dejar parciales).
        .filter((it) => {
          const v = it.invoices?.void_type;
          return v === null || v === undefined || v === 'partial';
        })
        .map((it) => {
          const inv = it.invoices;
          const respId = inv?.responsible_id ?? null;
          // Nombre canónico resuelto, usado TAMBIÉN como key → el mismo cliente
          // no se parte entre facturas con responsible_id y facturas viejas
          // (responsible_id null) que comparten counterparty_name.
          const name = (respId ? respName.get(respId) : null) ?? inv?.counterparty_name ?? 'Sin identificar';
          // NC parcial: reducir el ingreso de la línea proporcional al monto
          // anulado sobre el total de la factura.
          const total = Number(inv?.total_amount) || 0;
          const voided = inv?.void_type === 'partial' ? (Number(inv?.voided_amount) || 0) : 0;
          const factor = total > 0 && voided > 0 ? Math.max(0, 1 - voided / total) : 1;
          return {
            reference: it.reference ?? '',
            quantity: Number(it.quantity) || 0,
            ingreso: (Number(it.line_base) || 0) * factor,
            clientKey: name.trim().toLowerCase(),
            clientName: name,
          };
        });

      return computeProfitability(lines, costByRef);
    },
  });
}
