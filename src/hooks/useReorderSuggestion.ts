/**
 * Hook del motor de "¿cuándo montar el próximo pedido?" — ÚNICA fuente de
 * verdad para la card de sugerencia Y la celda del radar de abastecimiento
 * (antes cada uno calculaba distinto y se contradecían en pantalla).
 *
 * Junta: fechas de todos los pedidos (lead time por etapa), stock FÍSICO
 * (inventory_products.stock_physical — el del conteo QR propio, NO el de
 * Siigo que vive en stock_system), consumo real (salidas de inventario =
 * remisiones/despachos, últimos 90 días) y llegadas en tránsito (packing
 * list / proforma de los pedidos abiertos).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useImports, type ImportRow } from '@/hooks/useImports';
import {
  computeReorderSuggestion,
  estimateLeadTime,
  estimateDisponibilidad,
  CONSUMO_VENTANA_DIAS,
  type ImportFechas,
  type TransitoItem,
  type ReorderSuggestion,
} from '@/lib/reorderSuggestion';
import { refFamilyKey, variantKey, applyColorSuffix, colorFromSuffix } from '@/lib/refFamily';
import { computeFamilyDemand, type FamilyDemand, type DemandMovement } from '@/lib/demandModel';
import { buildVariantPrimitives, decorateVariants, type VarianteCobertura, type VentaRow } from '@/lib/coverageVariants';

interface ItemRow { import_id: string; reference: string; cantidad: number; peso_kg?: number | null; color?: string | null; source?: 'proforma' | 'packing' | null }

export interface PedidoSinItems {
  id: string;
  label: string;
}

/** Desglose de los pedidos abiertos QUE cuentan como cobertura (con items). */
export interface PipelineResumen {
  produccion: number;
  aduana: number;
  transito: number;
  total: number;
}

export interface UseReorderSuggestionResult {
  isPending: boolean;
  suggestion: ReorderSuggestion | null;
  /** Pedidos abiertos SIN packing list/proforma: no cuentan como cobertura. */
  pedidosSinItems: PedidoSinItems[];
  /** Contenedores contados en la proyección, por etapa (transparencia card). */
  pipeline: PipelineResumen;
  /** kg por unidad por familia (del packing/proforma de pedidos abiertos) —
   *  para estimar el peso del pedido sugerido. */
  kgPorUnidad: Map<string, number>;
  /** Días promedio entre pedidos (fecha_anticipo/cotización), acotado 20-120;
   *  45 por defecto mientras no haya historia. */
  cicloPedidoDias: number;
  /** Modelo de demanda por familia: consumo censurado, días con stock,
   *  serie mensual y estado de la estacionalidad. */
  demandPorFamilia: Map<string, FamilyDemand>;
  /** Cobertura por VARIANTE DE COLOR (LIV-40-2 ≠ LIV-40-3) — la vista con la
   *  que Nico monta pedido. Demanda desde remisiones; proforma con sufijo
   *  sintetizado; stock -5 repartido por mezcla cuando no hay por color. */
  porVariante: VarianteCobertura[];
  /** kg por unidad por VARIANTE (fallback: familia). */
  kgPorUnidadVariante: Map<string, number>;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Fecha en que el pedido entró a 'entregado' según su historial embebido. */
function fechaEntregado(r: ImportRow): string | null {
  const h = (r.import_estado_history ?? []).find((x) => x.estado === 'entregado');
  return h?.fecha ?? null;
}

export function useReorderSuggestion(): UseReorderSuggestionResult {
  const { data: importsData } = useImports();

  const inventoryQuery = useQuery({
    queryKey: ['imports', 'reorder-inventario'],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - CONSUMO_VENTANA_DIAS);
      const cutoffIso = cutoff.toISOString().slice(0, 10);

      // Historia larga (400d) para la serie mensual de estacionalidad; el
      // consumo censurado usa solo la ventana de 90d. Entradas + salidas:
      // con ambas se reconstruye el stock día a día (días con/sin stock).
      const cutoffSerie = new Date();
      cutoffSerie.setDate(cutoffSerie.getDate() - 400);
      const cutoffSerieIso = cutoffSerie.toISOString().slice(0, 10);

      const [prodRes, movRes] = await Promise.all([
        // stock_physical = inventario físico propio (conteo QR). stock_system
        // (Siigo) NO se usa acá a propósito.
        supabase
          .from('inventory_products')
          .select('id, reference, stock_physical')
          .eq('active', true),
        // Salidas = despachos reales (remisiones); entradas = recepciones.
        supabase
          .from('inventory_movements')
          .select('product_id, movement_type, quantity, movement_date')
          .in('movement_type', ['salida', 'entrada'])
          .gte('movement_date', cutoffSerieIso),
      ]);
      if (prodRes.error) throw prodRes.error;
      if (movRes.error) throw movRes.error;
      void cutoffIso; // la ventana corta la aplica el modelo de demanda
      return {
        products: (prodRes.data ?? []) as { id: string; reference: string; stock_physical: number | null }[],
        movimientos: (movRes.data ?? []) as { product_id: string; movement_type: string; quantity: number; movement_date: string }[],
      };
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  const abiertos = importsData?.abiertos ?? [];
  const abiertosIds = abiertos.map((r) => r.id);
  const itemsQuery = useQuery({
    queryKey: ['imports', 'reorder-items-transito', abiertosIds.join('|')],
    enabled: abiertosIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as never as { from: (t: string) => any })
        .from('import_items')
        .select('import_id, reference, cantidad, peso_kg, color, source')
        .in('import_id', abiertosIds);
      if (error) throw error;
      const rows = (data ?? []) as ItemRow[];
      // Por pedido: el packing list definitivo MANDA; si no hay, el proforma.
      // (Sumar ambos duplicaría el contenedor en la cobertura.)
      const conPacking = new Set(rows.filter((r) => (r.source ?? 'packing') === 'packing').map((r) => r.import_id));
      return rows.filter((r) =>
        conPacking.has(r.import_id) ? (r.source ?? 'packing') === 'packing' : true,
      );
    },
    staleTime: 10 * 60_000,
  });

  // Ventas por remisión: la referencia TAL COMO SE DESPACHÓ (con sufijo de
  // color si el equipo lo usa) — la demanda por variante sale de acá, no de
  // inventory_movements (que viven al nivel del producto -5 de Siigo).
  const ventasQuery = useQuery({
    queryKey: ['imports', 'reorder-ventas-remision'],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - CONSUMO_VENTANA_DIAS);
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      const { data, error } = await (supabase as never as { from: (t: string) => any })
        .from('remision_items')
        .select('reference, units, remisiones!inner(date, remision_type)')
        .eq('remisiones.remision_type', 'venta')
        .gte('remisiones.date', cutoffIso);
      if (error) throw error;
      return ((data ?? []) as { reference: string; units: number; remisiones: { date: string } }[])
        .map((r) => ({ reference: r.reference, units: Number(r.units ?? 0), date: r.remisiones?.date ?? '' }));
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  // Inventario por VARIANTE (LIV-40-3…): fuente real de stock, desprendida de
  // la -5. Si está vacío (maestra sin subir) se cae al -5 de inventory_products
  // para no romper nada antes de sembrar.
  const variantsQuery = useQuery({
    queryKey: ['imports', 'reorder-variantes'],
    queryFn: async () => {
      const { data, error } = await (supabase as never as { from: (t: string) => any })
        .from('inventory_variants')
        .select('variant_reference, stock')
        .eq('active', true);
      if (error) throw error;
      return (data ?? []) as { variant_reference: string; stock: number }[];
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  // OJO: esperar TAMBIÉN los items — computar sin ellos mostraba "0 llegadas
  // en tránsito" y una fecha alarmista mientras la query seguía en vuelo.
  const itemsPending = abiertosIds.length > 0 && itemsQuery.isPending;
  const pipelineVacio: PipelineResumen = { produccion: 0, aduana: 0, transito: 0, total: 0 };
  if (!importsData || inventoryQuery.isPending || ventasQuery.isPending || variantsQuery.isPending || itemsPending) {
    return { isPending: true, suggestion: null, pedidosSinItems: [], pipeline: pipelineVacio, kgPorUnidad: new Map(), cicloPedidoDias: 45, demandPorFamilia: new Map(), porVariante: [], kgPorUnidadVariante: new Map() };
  }

  const today = isoToday();
  const fechas: ImportFechas[] = (importsData.all ?? []).map((r) => ({
    estado: r.estado,
    fecha_anticipo: r.fecha_anticipo,
    fecha_embarque: r.fecha_embarque,
    fecha_estimada_llegada: r.fecha_estimada_llegada,
    fecha_arribo_real: r.fecha_arribo_real,
    fecha_entregado: fechaEntregado(r),
  }));
  const leadTime = estimateLeadTime(fechas);

  // Packing list / proforma de pedidos abiertos → llegadas proyectadas a bodega.
  const items = itemsQuery.data ?? [];
  const dispPorImport = new Map<string, string>(
    abiertos.map((r) => [r.id, estimateDisponibilidad(
      { ...r, fecha_entregado: null },
      leadTime,
      today,
    )]),
  );
  const idsConItems = new Set(items.map((it) => it.import_id));
  const pedidosSinItems: PedidoSinItems[] = abiertos
    .filter((r) => !idsConItems.has(r.id))
    .map((r) => ({ id: r.id, label: r.ref_pedido || r.proveedor_nombre }));

  // Contenedores que la proyección SÍ está contando (abiertos con items),
  // por etapa — para que la card muestre "qué está mirando el modelo".
  const pipeline: PipelineResumen = { produccion: 0, aduana: 0, transito: 0, total: 0 };
  for (const r of abiertos) {
    if (!idsConItems.has(r.id)) continue;
    pipeline.total += 1;
    if (r.estado === 'aduana') pipeline.aduana += 1;
    else if (r.estado === 'transito') pipeline.transito += 1;
    else pipeline.produccion += 1; // cotización/anticipo/producción
  }

  const inv = inventoryQuery.data!;

  // El cálculo es "sobre el -5": si existieran variantes de color como filas
  // propias (LIV-40-2, LIV-40-3...), se agrupan con la -5 en una sola familia
  // — stock sumado, consumo sumado. La etiqueta visible es la ref de Siigo
  // (la -5) cuando existe.
  interface Familia { key: string; label: string; stock: number; productIds: string[] }
  const familias = new Map<string, Familia>();
  for (const p of inv.products) {
    const key = refFamilyKey(p.reference);
    if (!key) continue;
    const f = familias.get(key) ?? { key, label: p.reference, stock: 0, productIds: [] };
    f.stock += Number(p.stock_physical ?? 0);
    f.productIds.push(p.id);
    // Preferir la -5 como etiqueta (es la nomenclatura que usa Nico).
    if (/-5$/i.test(p.reference.trim())) f.label = p.reference;
    familias.set(key, f);
  }
  const familiaPorProductId = new Map<string, string>();
  for (const f of familias.values()) {
    for (const id of f.productIds) familiaPorProductId.set(id, f.key);
  }

  // ── Modelo de demanda por familia: consumo CENSURADO por días con stock
  // (idea de Nico: medir solo cuando había con qué vender) + serie mensual
  // para estacionalidad (se activa sola a los 12 meses de historia). ──
  const movsPorFamilia = new Map<string, DemandMovement[]>();
  for (const m of inv.movimientos) {
    const fam = familiaPorProductId.get(m.product_id);
    if (!fam) continue;
    const arr = movsPorFamilia.get(fam) ?? [];
    arr.push({
      tipo: m.movement_type === 'entrada' ? 'entrada' : 'salida',
      quantity: Number(m.quantity ?? 0),
      date: (m.movement_date ?? '').slice(0, 10),
    });
    movsPorFamilia.set(fam, arr);
  }
  const demandPorFamilia = new Map<string, FamilyDemand>();
  for (const f of familias.values()) {
    const demanda = computeFamilyDemand({
      todayIso: today,
      ventanaDias: CONSUMO_VENTANA_DIAS,
      stockActual: f.stock,
      movimientos: movsPorFamilia.get(f.key) ?? [],
    });
    demandPorFamilia.set(f.key, demanda);
  }

  // NOTA: la fecha global YA NO se calcula a nivel familia — se calcula con
  // las MISMAS variantes de la tabla de Cobertura (ver más abajo). Antes eran
  // dos modelos distintos y se contradecían en pantalla (tabla con quiebres
  // ya encima y banner diciendo 2037).

  // kg por unidad por familia — del packing/proforma de los pedidos abiertos.
  const kgAcc = new Map<string, { kg: number; cant: number }>();
  for (const it of items) {
    const kg = Number(it.peso_kg ?? 0);
    const cant = Number(it.cantidad ?? 0);
    if (kg <= 0 || cant <= 0) continue;
    const key = refFamilyKey(it.reference);
    const acc = kgAcc.get(key) ?? { kg: 0, cant: 0 };
    acc.kg += kg; acc.cant += cant;
    kgAcc.set(key, acc);
  }
  const kgPorUnidad = new Map<string, number>(
    [...kgAcc.entries()].map(([k, v]) => [k, v.kg / v.cant]),
  );

  // Ciclo entre pedidos: promedio de los gaps entre fechas de anticipo (o
  // cotización) de los últimos pedidos. Acotado a [20, 120]; 45 sin historia.
  const fechasPedido = (importsData.all ?? [])
    .filter((r) => r.estado !== 'cancelado')
    .map((r) => r.fecha_anticipo ?? r.fecha_cotizacion)
    .filter((f): f is string => !!f)
    .sort();
  const gaps: number[] = [];
  for (let i = 1; i < fechasPedido.length; i++) {
    const d = Math.round((new Date(fechasPedido[i]).getTime() - new Date(fechasPedido[i - 1]).getTime()) / 86_400_000);
    if (d > 0) gaps.push(d);
  }
  const ultimos = gaps.slice(-6);
  const cicloPedidoDias = ultimos.length
    ? Math.min(120, Math.max(20, Math.round(ultimos.reduce((a, b) => a + b, 0) / ultimos.length)))
    : 45;

  // ── Cobertura por VARIANTE DE COLOR ──
  // Tránsito re-mapeado a variante: al proforma (sin sufijo) la app le pone
  // el sufijo desde su columna Color; el packing ya viene con sufijo.
  const transitoVariante: TransitoItem[] = items
    .filter((it) => dispPorImport.has(it.import_id))
    .map((it) => {
      const refConSufijo = applyColorSuffix(it.reference, it.color ?? null);
      return {
        reference: refConSufijo,
        cantidad: Number(it.cantidad ?? 0),
        fechaDisponible: dispPorImport.get(it.import_id)!,
        matchKey: variantKey(refConSufijo),
      };
    });

  // Factor de demanda por familia — TODO lo que sabemos de la demanda entra
  // también a la FECHA de quiebre, no solo al sugerido de Cobertura:
  //   censura (vendió en ⅓ de los días → la tasa real es 3×, piso 1)
  //   × tendencia 30d × estacionalidad ponderada (factorDemanda, 0.5–2.2).
  // Antes la fecha usaba consumo plano de 90d: diciembre alto NO adelantaba
  // el pedido de fin de año (feedback de Nico: "fijo debo montar antes del
  // 20 de octubre"). Ahora el índice estacional corre la fecha solo.
  const factorDemandaPorFamilia = new Map<string, number>();
  for (const [fam, d] of demandPorFamilia) {
    const censura = d.consumoDiarioSimple > 0 && d.consumoDiario > 0
      ? Math.max(1, d.consumoDiario / d.consumoDiarioSimple)
      : 1;
    const factor = censura * (d.factorDemanda || 1);
    if (factor !== 1) factorDemandaPorFamilia.set(fam, factor);
  }

  const ventas: VentaRow[] = ventasQuery.data ?? [];

  // Stock para la cobertura: por VARIANTE real si ya hay maestra cargada; si no,
  // el -5 de inventory_products (comportamiento anterior, con reparto por mezcla).
  const variantes = variantsQuery.data ?? [];
  const inventarioCobertura = variantes.length
    ? variantes.map((v) => ({ reference: v.variant_reference, stockPhysical: Number(v.stock ?? 0) }))
    : inv.products.map((p) => ({ reference: p.reference, stockPhysical: Number(p.stock_physical ?? 0) }));

  const prims = buildVariantPrimitives({
    todayIso: today,
    ventanaDias: CONSUMO_VENTANA_DIAS,
    ventas,
    inventario: inventarioCobertura,
    transito: transitoVariante,
    factorDemandaPorFamilia,
  });

  // UNA sola corrida del motor, sobre las variantes: fecha global (banner y
  // radar) y tabla de cobertura salen del mismo cálculo.
  const suggestion = computeReorderSuggestion({
    todayIso: today,
    imports: fechas,
    stock: prims.stockRows,
    salidas: prims.salidas,
    transito: prims.transito,
    consumoPorProducto: prims.consumoPorVariante,
  });
  // Las filas "-5" (total Siigo) sin consumo salen de la vista: no discriminan
  // color y su stock ya se repartió entre las variantes — solo ensucian la
  // tabla ("sin discriminar / sin consumo" × 100+, feedback de Nico). Si una
  // -5 tuviera consumo real (remisión despachada como -5), se queda: es dato.
  const porVariante = decorateVariants(suggestion.porReferencia, prims)
    .filter((v) => !(v.sinConsumo && colorFromSuffix(v.key) === 'total'));

  // kg/unidad por variante (del packing/proforma), con fallback a familia.
  const kgVarAcc = new Map<string, { kg: number; cant: number }>();
  for (const it of items) {
    const kg = Number(it.peso_kg ?? 0);
    const cant = Number(it.cantidad ?? 0);
    if (kg <= 0 || cant <= 0) continue;
    const key = variantKey(applyColorSuffix(it.reference, it.color ?? null));
    const acc = kgVarAcc.get(key) ?? { kg: 0, cant: 0 };
    acc.kg += kg; acc.cant += cant;
    kgVarAcc.set(key, acc);
  }
  const kgPorUnidadVariante = new Map<string, number>(
    [...kgVarAcc.entries()].map(([k, v]) => [k, v.kg / v.cant]),
  );

  return { isPending: false, suggestion, pedidosSinItems, pipeline, kgPorUnidad, cicloPedidoDias, demandPorFamilia, porVariante, kgPorUnidadVariante };
}
