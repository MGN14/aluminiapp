import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getYearRange } from '@/lib/dateUtils';
import { computeProfitability, type SaleLine, type ProfitabilityResult } from '@/lib/profitability';

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

/**
 * Rentabilidad por referencia y por cliente del año: cruza las líneas de
 * factura de venta (confirmadas, no anuladas) contra el costo de inventario.
 */
export function useProfitability(year: number) {
  const { user } = useAuth();

  return useQuery<ProfitabilityResult>({
    queryKey: ['profitability-v2', user?.id, year],
    enabled: !!user,
    queryFn: async () => {
      const { start, end } = getYearRange(year);

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
