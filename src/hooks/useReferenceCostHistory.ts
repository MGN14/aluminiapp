import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { computeLandedCost, type LandedCostInput, type LandedItemInput } from '@/lib/landedCost';
import { applyColorSuffix, variantKey } from '@/lib/refFamily';
import { fechaEntregaImport, type EstadoHistoryEntry } from '@/lib/importStages';
import { estadoLoteDe, type RefCostPointInput } from '@/lib/costoProyectado';

export type { RefCostPoint, RefCostSeries } from '@/lib/costoProyectado';

/**
 * Histórico de costo por VARIANTE a través de TODAS las importaciones —
 * reales Y proyectadas:
 *
 *   · REAL (entregado / cerrado): landed con la TRM ponderada de sus abonos,
 *     como siempre. Sin TRM se omite (ensuciaría el histórico).
 *   · PROYECTADO (aduana / tránsito / fábrica): antes estos pedidos no
 *     existían para Análisis de precios hasta tener abonos. Ahora entran con
 *       - TRM MIXTA: lo ya girado a la TRM real de cada abono + el saldo a la
 *         TRM de hoy (misma regla que Escenarios). Sin abonos, TRM de hoy.
 *       - Nacionalización: los costos del pedido si ya los tiene (incluidas
 *         las filas "estimado" de Escenarios). Si no tiene ninguno, se
 *         estiman con la ESTRUCTURA DEL ÚLTIMO ENTREGADO (COP/kg, o % del
 *         FOB si el pedido no trae peso) — el mismo criterio de "molde" que
 *         usa el comparativo (importComparison.columnaHoy).
 *     Todo proyectado queda marcado (proyectado / trmEstimada /
 *     costosEstimados) para que la UI nunca lo lea como dato real.
 *
 * Por cada pedido, el packing list MANDA sobre la proforma (como en el
 * Costeo del pedido): sumar ambos duplicaba la carga.
 *
 * La fecha de un lote proyectado es provisional (ETA a puerto o hoy); el hook
 * usePrecioProyectado la reemplaza por la llegada a bodega que calcula el
 * motor de reorden, para que Precios y Cobertura digan la misma fecha.
 */

export interface CostHistorySupuestos {
  trmHoy: number | null;
  /** Pedidos abiertos que entraron como proyectados. */
  abiertosProyectados: number;
  /** Pedidos abiertos que NO entraron: sin TRM de hoy ni abonos. */
  abiertosSinTrm: number;
  /** Pedidos abiertos cuya nacionalización se estimó con el molde. */
  abiertosCostosEstimados: number;
  /** El contenedor entregado que sirve de molde para estimar costos. */
  moldeLabel: string | null;
  moldeCostosPorKg: number | null;
}

export interface CostHistoryData {
  points: RefCostPointInput[];
  supuestos: CostHistorySupuestos;
}

interface ImpRow {
  id: string;
  proveedor_nombre: string;
  ref_pedido: string | null;
  precio_smm_cerrado_usd_ton: number | null;
  fecha_arribo_real: string | null;
  fecha_estimada_llegada: string | null;
  fecha_anticipo: string | null;
  fecha_cotizacion: string | null;
  created_at: string;
  estado: string;
  saldo_pendiente_usd: number | null;
  monto_total_usd: number | null;
  peso_real_kg: number | null;
  cantidad_ton: number | null;
  import_estado_history?: EstadoHistoryEntry[] | null;
}

type ItemRow = LandedItemInput & { import_id: string; color?: string | null; source?: 'proforma' | 'packing' | null };

function fechaReal(imp: ImpRow): string {
  return (
    fechaEntregaImport(imp) ||
    imp.fecha_arribo_real ||
    imp.fecha_estimada_llegada ||
    imp.fecha_anticipo ||
    imp.fecha_cotizacion ||
    imp.created_at.slice(0, 10)
  );
}

const n0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function useReferenceCostHistory(opts?: { trmHoy?: number | null }) {
  const { user } = useAuth();
  const trmHoy = n0(opts?.trmHoy) > 0 ? Number(opts!.trmHoy) : null;

  return useQuery<CostHistoryData>({
    queryKey: ['import_reference_history', user?.id, trmHoy != null ? Math.round(trmHoy) : 0],
    enabled: !!user,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Traemos todo de una; el volumen de importaciones es bajo (decenas).
      const [impRes, itemsRes, costsRes, liqRes] = await Promise.all([
        supabase.from('imports' as never).select(
          'id, proveedor_nombre, ref_pedido, precio_smm_cerrado_usd_ton, fecha_arribo_real, fecha_estimada_llegada, fecha_anticipo, fecha_cotizacion, created_at, estado, saldo_pendiente_usd, monto_total_usd, peso_real_kg, cantidad_ton, import_estado_history(estado, fecha)',
        ).order('created_at', { ascending: true }),
        supabase.from('import_items' as never).select('*'),
        supabase.from('import_costs' as never).select('*'),
        supabase.from('imports_liquidation' as never).select('import_id, trm_promedio_ponderada, total_pagado_usd, total_pagado_cop'),
      ]);
      if (impRes.error) throw impRes.error;

      const imports = ((impRes.data as unknown) as ImpRow[]) ?? [];
      const allItems = ((itemsRes.data as unknown) as ItemRow[]) ?? [];
      const allCosts = ((costsRes.data as unknown) as Array<LandedCostInput & { import_id: string }>) ?? [];
      const liqByImport = new Map<string, { trm: number | null; pagadoUsd: number; pagadoCop: number | null }>(
        (((liqRes.data as unknown) as Array<{ import_id: string; trm_promedio_ponderada: number | null; total_pagado_usd: number | null; total_pagado_cop: number | null }>) ?? [])
          .map((r) => [r.import_id, { trm: r.trm_promedio_ponderada, pagadoUsd: n0(r.total_pagado_usd), pagadoCop: r.total_pagado_cop }]),
      );

      // Items por pedido: packing manda; si no hay, proforma.
      const itemsPorImport = new Map<string, ItemRow[]>();
      for (const it of allItems) {
        const arr = itemsPorImport.get(it.import_id) ?? [];
        arr.push(it);
        itemsPorImport.set(it.import_id, arr);
      }
      const itemsEfectivos = (importId: string): ItemRow[] => {
        const rows = itemsPorImport.get(importId) ?? [];
        const sourceOf = (r: ItemRow) => r.source ?? 'packing';
        const hayPacking = rows.some((r) => sourceOf(r) === 'packing');
        return hayPacking ? rows.filter((r) => sourceOf(r) === 'packing') : rows;
      };
      const costsPorImport = new Map<string, LandedCostInput[]>();
      for (const c of allCosts) {
        const arr = costsPorImport.get(c.import_id) ?? [];
        arr.push(c);
        costsPorImport.set(c.import_id, arr);
      }

      // ── Molde para estimar nacionalización: el último entregado con costeo ──
      const entregados = imports
        .filter((imp) => estadoLoteDe(imp.estado) === 'entregado')
        .sort((a, b) => fechaReal(b).localeCompare(fechaReal(a)));
      let molde: { label: string; costosPorKg: number | null; costosPctFob: number | null } | null = null;
      for (const imp of entregados) {
        const items = itemsEfectivos(imp.id);
        const trm = liqByImport.get(imp.id)?.trm ?? null;
        if (!items.length || !trm || trm <= 0) continue;
        const landed = computeLandedCost(items, costsPorImport.get(imp.id) ?? [], trm);
        if (landed.totals.costos_total_cop <= 0) continue;
        molde = {
          label: imp.ref_pedido || imp.proveedor_nombre,
          costosPorKg: landed.totals.peso_total_kg > 0 ? landed.totals.costos_total_cop / landed.totals.peso_total_kg : null,
          costosPctFob: landed.totals.fob_total_cop > 0 ? landed.totals.costos_total_cop / landed.totals.fob_total_cop : null,
        };
        break;
      }

      const supuestos: CostHistorySupuestos = {
        trmHoy,
        abiertosProyectados: 0,
        abiertosSinTrm: 0,
        abiertosCostosEstimados: 0,
        moldeLabel: molde?.label ?? null,
        moldeCostosPorKg: molde?.costosPorKg != null ? Math.round(molde.costosPorKg) : null,
      };

      const points: RefCostPointInput[] = [];
      for (const imp of imports) {
        const estado = estadoLoteDe(imp.estado);
        if (!estado) continue;
        const items = itemsEfectivos(imp.id);
        if (items.length === 0) continue;
        const proyectado = estado !== 'entregado';
        const liq = liqByImport.get(imp.id);

        // ── TRM: real (ponderada de abonos) o mixta con la de hoy ──
        let trm: number | null = null;
        let trmEstimada = false;
        if (!proyectado) {
          trm = liq?.trm ?? null;
        } else {
          const trmPond = liq?.trm != null && liq.trm > 0 ? liq.trm : null;
          const pagadoUsd = liq?.pagadoUsd ?? 0;
          const pagadoCop = liq?.pagadoCop != null ? n0(liq.pagadoCop) : (trmPond ? pagadoUsd * trmPond : 0);
          const saldoUsd = Math.max(0, imp.saldo_pendiente_usd != null ? n0(imp.saldo_pendiente_usd) : n0(imp.monto_total_usd) - pagadoUsd);
          if (pagadoUsd > 0 && saldoUsd <= 0) {
            trm = pagadoCop / pagadoUsd; // todo girado: la TRM ya es real
          } else if (trmHoy) {
            const base = pagadoUsd + saldoUsd;
            trm = base > 0 ? (pagadoCop + saldoUsd * trmHoy) / base : trmHoy;
            trmEstimada = true;
          } else if (trmPond) {
            trm = trmPond; // sin TRM de hoy: la parcial, marcada
            trmEstimada = true;
          }
        }
        if (!trm || trm <= 0) {
          if (proyectado) supuestos.abiertosSinTrm++;
          continue;
        }

        // ── Costos: los del pedido; si no tiene, el molde del último entregado ──
        let costs = costsPorImport.get(imp.id) ?? [];
        let costosEstimados = false;
        if (proyectado && costs.length === 0 && molde) {
          const pesoItems = items.reduce((s, it) => s + n0(it.peso_kg), 0);
          const pesoTotal = pesoItems > 0 ? pesoItems : (n0(imp.peso_real_kg) > 0 ? n0(imp.peso_real_kg) : n0(imp.cantidad_ton) * 1000);
          const fobUsd = items.reduce((s, it) => s + n0(it.fob_total_usd), 0);
          if (pesoTotal > 0 && molde.costosPorKg) {
            costs = [{ id: `est-kg-${imp.id}`, tipo: 'otro', concepto: `estimado — estructura de ${molde.label}`, monto: molde.costosPorKg * pesoTotal, moneda: 'COP', trm: null, base_asignacion: 'peso' }];
            costosEstimados = true;
          } else if (fobUsd > 0 && molde.costosPctFob) {
            costs = [{ id: `est-fob-${imp.id}`, tipo: 'otro', concepto: `estimado — estructura de ${molde.label}`, monto: molde.costosPctFob * fobUsd * trm, moneda: 'COP', trm: null, base_asignacion: 'valor' }];
            costosEstimados = true;
          }
        }

        const landed = computeLandedCost(items, costs, trm);
        if (landed.trmUsada <= 0) continue;
        if (proyectado) {
          supuestos.abiertosProyectados++;
          if (costosEstimados) supuestos.abiertosCostosEstimados++;
        }
        // Proyectado: fecha provisional (ETA a puerto o hoy); usePrecioProyectado
        // la reemplaza por la llegada a bodega del motor de reorden.
        const fecha = proyectado
          ? (imp.fecha_estimada_llegada && imp.fecha_estimada_llegada >= today ? imp.fecha_estimada_llegada : today)
          : fechaReal(imp);
        const colorPorItem = new Map(items.map((it) => [it.id, it.color ?? null]));

        // Consolidar por VARIANTE dentro del pedido (un desembarco = un pedido,
        // no una línea del packing).
        const byKey = new Map<string, { ref: string; desc: string | null; cant: number; peso: number; pesoSeen: boolean; fob: number; landedTotal: number }>();
        for (const r of landed.items) {
          const refVar = applyColorSuffix(r.reference, colorPorItem.get(r.id));
          const k = variantKey(refVar);
          if (!k) continue;
          const acc = byKey.get(k) ?? { ref: refVar, desc: r.descripcion, cant: 0, peso: 0, pesoSeen: false, fob: 0, landedTotal: 0 };
          acc.cant += r.cantidad;
          if (r.peso_kg !== null) { acc.peso += n0(r.peso_kg); acc.pesoSeen = true; }
          acc.fob += r.fob_total_usd;
          acc.landedTotal += r.landed_total_cop;
          if (!acc.desc && r.descripcion) acc.desc = r.descripcion;
          byKey.set(k, acc);
        }

        for (const [key, acc] of byKey) {
          const fobUsdKg = acc.pesoSeen && acc.peso > 0 && acc.fob > 0 ? acc.fob / acc.peso : null;
          points.push({
            key,
            reference: acc.ref,
            descripcion: acc.desc,
            created_at: imp.created_at,
            import_id: imp.id,
            pedido: imp.ref_pedido || imp.proveedor_nombre,
            proveedor: imp.proveedor_nombre,
            estado,
            proyectado,
            fecha,
            smm_usd_ton: imp.precio_smm_cerrado_usd_ton,
            trm: landed.trmUsada,
            trmEstimada,
            costosEstimados,
            cantidad: acc.cant,
            peso_kg: acc.pesoSeen ? acc.peso : null,
            fob_total_usd: acc.fob,
            landed_unit_cop: acc.cant > 0 ? Math.round(acc.landedTotal / acc.cant) : 0,
            landed_por_kg_cop: acc.pesoSeen && acc.peso > 0 ? Math.round(acc.landedTotal / acc.peso) : null,
            delta_unit_pct: null,
            fob_usd_kg: fobUsdKg !== null ? Math.round(fobUsdKg * 100) / 100 : null,
            prima_smm_usd_ton: fobUsdKg !== null && imp.precio_smm_cerrado_usd_ton
              ? Math.round(fobUsdKg * 1000 - imp.precio_smm_cerrado_usd_ton)
              : null,
          });
        }
      }

      return { points, supuestos };
    },
  });
}
