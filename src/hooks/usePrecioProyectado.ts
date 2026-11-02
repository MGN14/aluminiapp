/**
 * Hook de la pestaña Análisis de precios — junta en un solo lugar:
 *   · el histórico de costo por variante, real y PROYECTADO (useReferenceCostHistory)
 *   · la llegada a bodega de cada pedido abierto (motor de reorden: la misma
 *     fecha que muestra Cobertura, para que las dos pestañas no se contradigan)
 *   · el stock y el costo promedio ACTUAL por variante (inventory_variants;
 *     fallback al -5 de inventory_products si la maestra no está sembrada)
 *   · la lista de precios por familia (useListaPrecios)
 * y se lo pasa a computeCostoProyectado (lib pura). Solo lectura.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import { useReferenceCostHistory } from '@/hooks/useReferenceCostHistory';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { useListaPrecios, listaPreciosIndex } from '@/hooks/useListaPrecios';
import {
  buildRefCostSeries, computeCostoProyectado,
  type RefCostoInput, type FuenteCostoActual,
} from '@/lib/costoProyectado';
import { refFamilyKey, variantKey, colorLabel } from '@/lib/refFamily';

/** Misma llave que Impacto en lista: la decisión "mi lista está con IVA" es
 *  una sola para toda la app. */
const IVA_KEY = 'aluminia_lista_iva_incluido';

const todayIso = () => new Date().toISOString().slice(0, 10);
const n0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

interface StockCosto { stock: number; costo: number | null }

export function usePrecioProyectado() {
  const { user } = useAuth();

  const { data: trmHoyRaw = null } = useQuery({
    queryKey: ['trm-hoy'],
    queryFn: () => fetchTrmForDate(todayIso()),
    staleTime: 60 * 60_000,
  });
  const trmHoy = trmHoyRaw != null ? Number(trmHoyRaw) : null;

  const hist = useReferenceCostHistory({ trmHoy });
  const reorder = useReorderSuggestion();
  const { data: precios } = useListaPrecios();

  // Stock y costo promedio actual: por variante (mundo real) y por -5 (fallback).
  const stockQuery = useQuery({
    queryKey: ['imports', 'precio-stock-costo', user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [v, p] = await Promise.all([
        supabase.from('inventory_variants').select('variant_reference, stock, avg_cost').eq('active', true),
        supabase.from('inventory_products').select('reference, stock_physical, cost_per_unit').eq('active', true),
      ]);
      if (v.error) throw v.error;
      if (p.error) throw p.error;
      return {
        variantes: (v.data ?? []) as { variant_reference: string; stock: number | null; avg_cost: number | null }[],
        productos: (p.data ?? []) as { reference: string; stock_physical: number | null; cost_per_unit: number | null }[],
      };
    },
  });

  const [ivaIncluido, setIvaIncluido] = useState(() => {
    try { return localStorage.getItem(IVA_KEY) !== '0'; } catch { return true; }
  });
  const toggleIva = () => {
    setIvaIncluido((v) => {
      const nv = !v;
      try { localStorage.setItem(IVA_KEY, nv ? '1' : '0'); } catch { /* modo privado */ }
      return nv;
    });
  };

  // Fecha de los lotes proyectados = llegada a bodega del motor de reorden.
  // Se clonan los puntos: buildRefCostSeries escribe los Δ y el cache de la
  // query no se toca.
  const points = useMemo(() => {
    const eta = reorder.disponibilidadPorImport;
    return (hist.data?.points ?? []).map((p) => {
      const llegada = p.proyectado ? eta.get(p.import_id) : undefined;
      return llegada ? { ...p, fecha: llegada } : { ...p };
    });
  }, [hist.data, reorder.disponibilidadPorImport]);

  const series = useMemo(() => buildRefCostSeries(points), [points]);

  const sembrado = (stockQuery.data?.variantes.length ?? 0) > 0;

  const refs = useMemo((): RefCostoInput[] => {
    const idx = listaPreciosIndex(precios);
    const data = stockQuery.data;

    // Por variante: stock sumado; costo = promedio ponderado por stock de las
    // filas con avg_cost (si ninguna tiene stock, el avg_cost que exista).
    const porVariante = new Map<string, StockCosto & { valor: number; conCosto: number; algunCosto: number | null }>();
    for (const v of data?.variantes ?? []) {
      const k = variantKey(v.variant_reference);
      if (!k) continue;
      const acc = porVariante.get(k) ?? { stock: 0, costo: null, valor: 0, conCosto: 0, algunCosto: null };
      const st = Math.max(0, n0(v.stock));
      const c = n0(v.avg_cost);
      acc.stock += st;
      if (c > 0) { acc.valor += st * c; acc.conCosto += st; acc.algunCosto = acc.algunCosto ?? c; }
      porVariante.set(k, acc);
    }
    for (const acc of porVariante.values()) acc.costo = acc.conCosto > 0 ? acc.valor / acc.conCosto : acc.algunCosto;

    // Por familia (-5 de Siigo): fallback de stock y de costo (kardex).
    const porFamilia = new Map<string, StockCosto & { valor: number; conCosto: number; algunCosto: number | null }>();
    for (const p of data?.productos ?? []) {
      const fam = refFamilyKey(p.reference);
      if (!fam) continue;
      const acc = porFamilia.get(fam) ?? { stock: 0, costo: null, valor: 0, conCosto: 0, algunCosto: null };
      const st = Math.max(0, n0(p.stock_physical));
      const c = n0(p.cost_per_unit);
      acc.stock += st;
      if (c > 0) { acc.valor += st * c; acc.conCosto += st; acc.algunCosto = acc.algunCosto ?? c; }
      porFamilia.set(fam, acc);
    }
    for (const acc of porFamilia.values()) acc.costo = acc.conCosto > 0 ? acc.valor / acc.conCosto : acc.algunCosto;

    // Sin maestra de variantes, el stock del -5 solo se puede atribuir a una
    // variante si es la única de su familia (si no, no se sabe repartirlo).
    const seriesPorFamilia = new Map<string, number>();
    for (const s of series) {
      const fam = refFamilyKey(s.key);
      seriesPorFamilia.set(fam, (seriesPorFamilia.get(fam) ?? 0) + 1);
    }

    return series.map((s) => {
      const familia = refFamilyKey(s.key);
      const v = porVariante.get(s.key);
      const f = porFamilia.get(familia);
      let stockActual = 0;
      let costoActual: number | null = null;
      let costoActualFuente: FuenteCostoActual | null = null;
      if (sembrado) {
        stockActual = v?.stock ?? 0;
        if (v?.costo) { costoActual = v.costo; costoActualFuente = 'variante'; }
      } else if (f && (seriesPorFamilia.get(familia) ?? 0) === 1) {
        stockActual = f.stock;
      }
      if (costoActual == null && f?.costo) { costoActual = f.costo; costoActualFuente = 'kardex'; }
      const precio = idx.get(familia);
      return {
        key: s.key,
        familia,
        reference: s.reference,
        color: colorLabel(s.reference),
        descripcion: s.descripcion,
        stockActual,
        costoActual,
        costoActualFuente,
        lotes: s.points,
        precioLista: precio && precio.sale > 0 ? precio.sale : null,
      };
    });
  }, [series, precios, stockQuery.data, sembrado]);

  const result = useMemo(() => computeCostoProyectado(refs, { ivaIncluido }), [refs, ivaIncluido]);

  return {
    isLoading: hist.isLoading || stockQuery.isLoading,
    series,
    refs: result.refs,
    kpis: result.kpis,
    supuestos: hist.data?.supuestos ?? null,
    /** De dónde sale el costo actual del stock: la maestra por variante o el kardex -5. */
    costoFuente: (sembrado ? 'variante' : 'kardex') as FuenteCostoActual,
    ivaIncluido,
    toggleIva,
    trmHoy,
  };
}
