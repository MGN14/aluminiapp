import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { computeLandedCost, type LandedCostInput, type LandedItemInput } from '@/lib/landedCost';

/**
 * Histórico de costo por referencia a través de TODAS las importaciones.
 * Por cada pedido calcula el landed cost de sus ítems y aplana a una serie
 * por referencia, ordenada por fecha, con la variación vs el desembarco
 * anterior. Es la base para "comparar entre referencias" y ver variación de
 * precios (landed, FOB, TRM, SMM, flete del pedido).
 */

export interface RefCostPoint {
  import_id: string;
  proveedor: string;
  fecha: string;                 // fecha relevante del pedido (arribo/ETA/anticipo/cotización)
  smm_usd_ton: number | null;    // precio SMM cerrado del pedido
  trm: number;                   // TRM efectiva usada
  cantidad: number;
  peso_kg: number | null;
  fob_total_usd: number;
  landed_unit_cop: number;
  landed_por_kg_cop: number | null;
  /** variación % del landed unitario vs el desembarco anterior de esta ref */
  delta_unit_pct: number | null;
}

export interface RefCostSeries {
  reference: string;
  descripcion: string | null;
  points: RefCostPoint[];        // ordenados por fecha asc
  last: RefCostPoint;            // desembarco más reciente
  first: RefCostPoint;           // primer desembarco registrado
  /** variación % del landed unitario entre el primero y el último */
  delta_total_pct: number | null;
}

function importDate(imp: {
  fecha_arribo_real: string | null;
  fecha_estimada_llegada: string | null;
  fecha_anticipo: string | null;
  fecha_cotizacion: string | null;
  created_at: string;
}): string {
  return (
    imp.fecha_arribo_real ||
    imp.fecha_estimada_llegada ||
    imp.fecha_anticipo ||
    imp.fecha_cotizacion ||
    imp.created_at.slice(0, 10)
  );
}

export function useReferenceCostHistory() {
  const { user } = useAuth();

  return useQuery<RefCostSeries[]>({
    queryKey: ['import_reference_history', user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Traemos todo de una; el volumen de importaciones es bajo (decenas).
      const [impRes, itemsRes, costsRes, liqRes] = await Promise.all([
        supabase.from('imports' as never).select(
          'id, proveedor_nombre, precio_smm_cerrado_usd_ton, fecha_arribo_real, fecha_estimada_llegada, fecha_anticipo, fecha_cotizacion, created_at, estado',
        ).order('created_at', { ascending: true }),
        supabase.from('import_items' as never).select('*'),
        supabase.from('import_costs' as never).select('*'),
        supabase.from('imports_liquidation' as never).select('import_id, trm_promedio_ponderada'),
      ]);
      if (impRes.error) throw impRes.error;

      const imports = ((impRes.data as unknown) as Array<{
        id: string; proveedor_nombre: string; precio_smm_cerrado_usd_ton: number | null;
        fecha_arribo_real: string | null; fecha_estimada_llegada: string | null;
        fecha_anticipo: string | null; fecha_cotizacion: string | null; created_at: string;
        estado: string;
      }>) ?? [];
      const allItems = ((itemsRes.data as unknown) as Array<LandedItemInput & { import_id: string }>) ?? [];
      const allCosts = ((costsRes.data as unknown) as Array<LandedCostInput & { import_id: string }>) ?? [];
      const trmByImport = new Map<string, number | null>(
        (((liqRes.data as unknown) as Array<{ import_id: string; trm_promedio_ponderada: number | null }>) ?? [])
          .map((r) => [r.import_id, r.trm_promedio_ponderada]),
      );

      // Aplanar: por cada import, calcular landed y emitir UN punto por
      // referencia (consolidando líneas repetidas dentro del mismo pedido,
      // para que "desembarcos" cuente pedidos y no líneas del packing list).
      type Pt = RefCostPoint & { reference: string; descripcion: string | null; _created: string };
      const points: Pt[] = [];
      for (const imp of imports) {
        if (imp.estado === 'cancelado') continue;
        const items = allItems.filter((it) => it.import_id === imp.id);
        if (items.length === 0) continue;
        const costs = allCosts.filter((c) => c.import_id === imp.id);
        const trm = trmByImport.get(imp.id) ?? null;
        const landed = computeLandedCost(items, costs, trm);
        // Sin TRM (ni abonos ni override persistido) el landed sale en 0 COP:
        // ensuciaría el histórico con caídas/saltos falsos. Lo omitimos.
        if (landed.trmUsada <= 0) continue;
        const fecha = importDate(imp);

        // Consolidar por referencia normalizada dentro del pedido.
        const byRefInImport = new Map<string, { ref: string; desc: string | null; cant: number; peso: number; pesoSeen: boolean; fob: number; landedTotal: number }>();
        for (const r of landed.items) {
          const k = r.reference.trim().toLowerCase();
          if (!k) continue;
          const acc = byRefInImport.get(k) ?? { ref: r.reference, desc: r.descripcion, cant: 0, peso: 0, pesoSeen: false, fob: 0, landedTotal: 0 };
          acc.cant += r.cantidad;
          if (r.peso_kg !== null) { acc.peso += r.peso_kg; acc.pesoSeen = true; }
          acc.fob += r.fob_total_usd;
          acc.landedTotal += r.landed_total_cop;
          if (!acc.desc && r.descripcion) acc.desc = r.descripcion;
          byRefInImport.set(k, acc);
        }

        for (const acc of byRefInImport.values()) {
          points.push({
            reference: acc.ref,
            descripcion: acc.desc,
            import_id: imp.id,
            proveedor: imp.proveedor_nombre,
            fecha,
            smm_usd_ton: imp.precio_smm_cerrado_usd_ton,
            trm: landed.trmUsada,
            cantidad: acc.cant,
            peso_kg: acc.pesoSeen ? acc.peso : null,
            fob_total_usd: acc.fob,
            landed_unit_cop: acc.cant > 0 ? Math.round(acc.landedTotal / acc.cant) : 0,
            landed_por_kg_cop: acc.pesoSeen && acc.peso > 0 ? Math.round(acc.landedTotal / acc.peso) : null,
            delta_unit_pct: null,
            _created: imp.created_at,
          });
        }
      }

      // Agrupar por referencia (normalizada) y ordenar por fecha.
      const byRef = new Map<string, Pt[]>();
      for (const p of points) {
        const key = p.reference.trim().toLowerCase();
        if (!key) continue;
        if (!byRef.has(key)) byRef.set(key, []);
        byRef.get(key)!.push(p);
      }

      const series: RefCostSeries[] = [];
      for (const group of byRef.values()) {
        // Orden estable: por fecha, desempatando por created_at del pedido.
        group.sort((a, b) => a.fecha.localeCompare(b.fecha) || a._created.localeCompare(b._created));
        // Variación punto a punto.
        for (let i = 1; i < group.length; i++) {
          const prev = group[i - 1].landed_unit_cop;
          const cur = group[i].landed_unit_cop;
          group[i].delta_unit_pct = prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
        }
        const first = group[0];
        const last = group[group.length - 1];
        const deltaTotal = first.landed_unit_cop > 0
          ? Math.round(((last.landed_unit_cop - first.landed_unit_cop) / first.landed_unit_cop) * 1000) / 10
          : null;
        series.push({
          reference: group[0].reference,
          descripcion: group.find((p) => p.descripcion)?.descripcion ?? null,
          points: group,
          first,
          last,
          delta_total_pct: deltaTotal,
        });
      }

      // Referencias con más desembarcos primero, luego alfabético.
      series.sort((a, b) => b.points.length - a.points.length || a.reference.localeCompare(b.reference));
      return series;
    },
  });
}
