/**
 * Análisis de precios con el pipeline completo — pedido de Nico 2026-10-31:
 * "ya hay suficiente información para hacer un verdadero análisis, con lo que
 * ha llegado, lo que viene en tránsito y está en fabricación".
 *
 * Tres preguntas, en orden:
 *   1. ¿Qué me costó de verdad? → lotes REALES (contenedores entregados, a la
 *      TRM ponderada de sus abonos). Es lo que ya hacía Análisis de precios.
 *   2. ¿Qué me va a costar lo que viene? → lotes PROYECTADOS (pedidos en
 *      aduana / tránsito / fábrica): landed con TRM mixta (lo ya girado a su
 *      TRM + el saldo a la TRM de hoy) y nacionalización estimada si el
 *      pedido todavía no tiene costos cargados. Antes estos pedidos no
 *      existían para la pestaña hasta tener abonos.
 *   3. ¿Con eso, a cuánto queda mi inventario y mi margen? → costo promedio
 *      PROYECTADO = (stock × costo actual + Σ en camino × landed proyectado)
 *      ÷ (stock + en camino), y margen mayorista a la lista de hoy, actual
 *      vs proyectado (computePriceImpact, la misma regla de Impacto en lista).
 *
 * Granularidad: VARIANTE de color (igual que Cobertura): el FOB cambia por
 * color. El precio de lista vive en la familia -5 (Siigo), así que se cruza
 * por familia.
 *
 * Funciones puras → testeables sin base de datos. Nada de acá escribe.
 */

import { computePriceImpact, MARGEN_RIESGO, type RefPrecio } from '@/lib/priceImpact';

export type EstadoLote = 'entregado' | 'aduana' | 'transito' | 'fabrica';

export const ESTADO_LOTE_LABEL: Record<EstadoLote, string> = {
  entregado: 'entregado',
  aduana: 'en aduana',
  transito: 'en tránsito',
  fabrica: 'en fábrica',
};

/** Etapa del lote según imports.estado. null = cancelado (no cuenta). */
export function estadoLoteDe(estado: string): EstadoLote | null {
  if (estado === 'cancelado') return null;
  if (estado === 'entregado' || estado === 'cerrado') return 'entregado';
  if (estado === 'aduana') return 'aduana';
  if (estado === 'transito') return 'transito';
  // produccion · listo_fabrica · cotizacion / anticipo (legacy, fuera del flujo)
  return 'fabrica';
}

/** Un desembarco (real) o una llegada (proyectada) de una variante. */
export interface RefCostPoint {
  import_id: string;
  /** ref_pedido o proveedor — como se nombra el contenedor en la app. */
  pedido: string;
  proveedor: string;
  estado: EstadoLote;
  /** true = pedido abierto: landed estimado, no costo real. */
  proyectado: boolean;
  /** Reales: fecha de entrega (o arribo/ETA legacy). Proyectados: llegada
   *  estimada a bodega. */
  fecha: string;
  smm_usd_ton: number | null;
  trm: number;
  /** true = la TRM lleva la de hoy (todo el pedido o solo el saldo sin girar). */
  trmEstimada: boolean;
  /** true = nacionalización estimada con la estructura del último entregado. */
  costosEstimados: boolean;
  cantidad: number;
  peso_kg: number | null;
  fob_total_usd: number;
  landed_unit_cop: number;
  landed_por_kg_cop: number | null;
  /** Reales: variación vs el desembarco anterior. Proyectados: vs el último real. */
  delta_unit_pct: number | null;
  fob_usd_kg: number | null;
  /** FOB USD/ton − SMM cerrado del pedido. */
  prima_smm_usd_ton: number | null;
}

export interface RefCostPointInput extends RefCostPoint {
  /** Llave de variante (variantKey) — agrupa la serie. */
  key: string;
  reference: string;
  descripcion: string | null;
  /** created_at del pedido: desempate estable al ordenar. */
  created_at: string;
}

export interface RefCostSeries {
  key: string;
  reference: string;
  descripcion: string | null;
  /** Reales por fecha, y después los proyectados por llegada estimada. */
  points: RefCostPoint[];
  reales: RefCostPoint[];
  proyectados: RefCostPoint[];
  /** Primer y último desembarco REAL. null si la variante nunca llegó. */
  first: RefCostPoint | null;
  last: RefCostPoint | null;
  /** Variación % del landed unitario entre el primero y el último real. */
  delta_total_pct: number | null;
  /** Promedio ponderado por cantidad de los reales: el costo histórico de compra. */
  avg_landed_unit_cop: number | null;
  /** Último real vs promedio ponderado: >0 = compraste más caro que tu histórico. */
  delta_vs_avg_pct: number | null;
}

const pct1 = (cur: number, base: number): number | null =>
  base > 0 ? Math.round(((cur - base) / base) * 1000) / 10 : null;

/** Agrupa los puntos por variante y arma la serie: reales con su variación
 *  punto a punto, proyectados con su variación vs el último real. */
export function buildRefCostSeries(points: RefCostPointInput[]): RefCostSeries[] {
  const byKey = new Map<string, RefCostPointInput[]>();
  for (const p of points) {
    if (!p.key) continue;
    const arr = byKey.get(p.key) ?? [];
    arr.push(p);
    byKey.set(p.key, arr);
  }

  const series: RefCostSeries[] = [];
  for (const [key, group] of byKey) {
    const orden = (a: RefCostPointInput, b: RefCostPointInput) =>
      a.fecha.localeCompare(b.fecha) || a.created_at.localeCompare(b.created_at);
    const reales = group.filter((p) => !p.proyectado).sort(orden);
    const proyectados = group.filter((p) => p.proyectado).sort(orden);

    for (let i = 1; i < reales.length; i++) {
      reales[i].delta_unit_pct = pct1(reales[i].landed_unit_cop, reales[i - 1].landed_unit_cop);
    }
    const first = reales[0] ?? null;
    const last = reales.length ? reales[reales.length - 1] : null;
    for (const p of proyectados) {
      p.delta_unit_pct = last ? pct1(p.landed_unit_cop, last.landed_unit_cop) : null;
    }

    const totalCant = reales.reduce((s, p) => s + p.cantidad, 0);
    const totalLanded = reales.reduce((s, p) => s + p.landed_unit_cop * p.cantidad, 0);
    const avg = totalCant > 0 ? Math.round(totalLanded / totalCant) : null;

    series.push({
      key,
      reference: group[0].reference,
      descripcion: group.find((p) => p.descripcion)?.descripcion ?? null,
      points: [...reales, ...proyectados],
      reales,
      proyectados,
      first,
      last,
      delta_total_pct: first && last ? pct1(last.landed_unit_cop, first.landed_unit_cop) : null,
      avg_landed_unit_cop: avg,
      delta_vs_avg_pct: last && avg ? pct1(last.landed_unit_cop, avg) : null,
    });
  }

  // Más desembarcos reales primero, luego alfabético.
  return series.sort((a, b) => b.reales.length - a.reales.length || a.reference.localeCompare(b.reference));
}

// ── Costo proyectado del inventario y margen ───────────────────────────────

export type FuenteCostoActual = 'variante' | 'kardex';

export interface RefCostoInput {
  key: string;
  familia: string;
  reference: string;
  color: string;
  descripcion: string | null;
  /** Stock físico actual de la variante (o de la familia, en fallback). */
  stockActual: number;
  /** Costo promedio actual de ese stock. null = el inventario no lo tiene. */
  costoActual: number | null;
  costoActualFuente: FuenteCostoActual | null;
  /** Todos los lotes, reales y proyectados. */
  lotes: RefCostPoint[];
  /** Precio de lista del maestro (familia -5). null/0 = sin precio. */
  precioLista: number | null;
}

export interface RefCostoProyectado extends RefCostoInput {
  ultimoReal: RefCostPoint | null;
  /** Lote proyectado que llega primero. */
  proximo: RefCostPoint | null;
  /** Unidades en camino (todos los lotes proyectados). */
  enCamino: number;
  /** Landed proyectado promedio de lo que viene, ponderado por unidades. */
  landedEnCamino: number | null;
  /** Costo con el que se valora el stock actual en el promedio: el del
   *  inventario, o el último real si el inventario no tiene costo. */
  costoBase: number | null;
  costoBaseFuente: FuenteCostoActual | 'ultimo_real' | null;
  /** (stock × costoBase + Σ camino × landed) ÷ (stock + camino). Sin camino,
   *  el costoBase. null si no hay con qué valorar. */
  costoProyectado: number | null;
  deltaCaminoVsUltimoRealPct: number | null;
  /** Lo que viene vs el costo actual del INVENTARIO (null si el inventario no tiene costo). */
  deltaCaminoVsActualPct: number | null;
  precioSinIva: number | null;
  margenActual: number | null;
  margenProyectado: number | null;
  /** Precio sin IVA que haría falta para volver al margen objetivo con el costo proyectado. */
  precioNecesario: number | null;
  ajustePct: number | null;
  riesgoProyectado: 'perdida' | 'riesgo' | null;
}

export interface CostoProyectadoKpis {
  refs: number;
  refsConCamino: number;
  unidadesEnCamino: number;
  /** Δ% ponderado por unidades en camino: landed proyectado vs costo actual del stock. */
  deltaCaminoVsActualPct: number | null;
  /** Refs cuyo landed en camino sube / baja más de UMBRAL_CAMBIO_PCT vs su costo actual. */
  refsSuben: number;
  refsBajan: number;
  refsConPrecio: number;
  /** Margen mayorista ponderado por valor: a costo actual y a costo proyectado. */
  margenActualPond: number | null;
  margenProyectadoPond: number | null;
  refsEnRiesgoProy: number;
  refsEnPerdidaProy: number;
  /** La de menor margen proyectado (entre las que tienen precio). */
  peorRef: RefCostoProyectado | null;
  /** % que habría que subir la lista (ponderado) para volver al objetivo con el costo proyectado. */
  ajusteNecesarioPct: number | null;
}

export const UMBRAL_CAMBIO_PCT = 5;

export function computeCostoProyectado(
  refs: RefCostoInput[],
  opts: { ivaIncluido: boolean; ivaPct?: number; margenObjetivo?: number },
): { refs: RefCostoProyectado[]; kpis: CostoProyectadoKpis } {
  const base: Omit<RefCostoProyectado, 'precioSinIva' | 'margenActual' | 'margenProyectado' | 'precioNecesario' | 'ajustePct' | 'riesgoProyectado'>[] = refs.map((r) => {
    const porFecha = (a: RefCostPoint, b: RefCostPoint) => a.fecha.localeCompare(b.fecha);
    const reales = r.lotes.filter((l) => !l.proyectado).sort(porFecha);
    const proy = r.lotes.filter((l) => l.proyectado).sort(porFecha);
    const ultimoReal = reales.length ? reales[reales.length - 1] : null;
    const proximo = proy[0] ?? null;
    const enCamino = proy.reduce((s, l) => s + Math.max(0, l.cantidad), 0);
    const landedEnCamino = enCamino > 0
      ? proy.reduce((s, l) => s + Math.max(0, l.cantidad) * l.landed_unit_cop, 0) / enCamino
      : null;

    const stock = Math.max(0, Number(r.stockActual) || 0);
    let costoBase: number | null = null;
    let costoBaseFuente: RefCostoProyectado['costoBaseFuente'] = null;
    if (r.costoActual != null && r.costoActual > 0) {
      costoBase = r.costoActual;
      costoBaseFuente = r.costoActualFuente ?? 'variante';
    } else if (ultimoReal && ultimoReal.landed_unit_cop > 0) {
      costoBase = ultimoReal.landed_unit_cop;
      costoBaseFuente = 'ultimo_real';
    }

    let costoProyectado: number | null;
    if (enCamino > 0 && landedEnCamino != null) {
      costoProyectado = stock > 0 && costoBase != null
        ? (stock * costoBase + enCamino * landedEnCamino) / (stock + enCamino)
        : landedEnCamino;
    } else {
      costoProyectado = costoBase;
    }

    return {
      ...r,
      stockActual: stock,
      ultimoReal,
      proximo,
      enCamino,
      landedEnCamino: landedEnCamino != null ? Math.round(landedEnCamino) : null,
      costoBase,
      costoBaseFuente,
      costoProyectado: costoProyectado != null ? Math.round(costoProyectado) : null,
      deltaCaminoVsUltimoRealPct: landedEnCamino != null && ultimoReal ? pct1(landedEnCamino, ultimoReal.landed_unit_cop) : null,
      deltaCaminoVsActualPct: landedEnCamino != null && r.costoActual != null && r.costoActual > 0 ? pct1(landedEnCamino, r.costoActual) : null,
    };
  });

  // Margen a lista de hoy: la misma regla de Impacto en lista, dos veces —
  // con el costo actual (lo que hay) y con el proyectado (lo que va a haber).
  const toRefPrecio = (r: (typeof base)[number], landedUnit: number, cantidad: number): RefPrecio => ({
    familia: r.familia, reference: r.reference, descripcion: r.descripcion,
    cantidad, landedUnit, precioLista: r.precioLista && r.precioLista > 0 ? r.precioLista : null,
  });
  const idxActual = base.map((r, i) => (r.costoBase != null ? i : -1)).filter((i) => i >= 0);
  const idxProy = base.map((r, i) => (r.costoProyectado != null ? i : -1)).filter((i) => i >= 0);
  const resActual = computePriceImpact(idxActual.map((i) => toRefPrecio(base[i], base[i].costoBase!, base[i].stockActual)), opts);
  const resProy = computePriceImpact(idxProy.map((i) => toRefPrecio(base[i], base[i].costoProyectado!, base[i].stockActual + base[i].enCamino)), opts);
  const actualPorIdx = new Map(idxActual.map((i, j) => [i, resActual.refs[j]]));
  const proyPorIdx = new Map(idxProy.map((i, j) => [i, resProy.refs[j]]));

  const out: RefCostoProyectado[] = base.map((r, i) => {
    const a = actualPorIdx.get(i);
    const p = proyPorIdx.get(i);
    const margenProyectado = p?.margen ?? null;
    const riesgoProyectado: RefCostoProyectado['riesgoProyectado'] = margenProyectado == null ? null
      : margenProyectado < 0 ? 'perdida'
      : margenProyectado < MARGEN_RIESGO ? 'riesgo'
      : null;
    return {
      ...r,
      precioSinIva: p?.precioSinIva ?? a?.precioSinIva ?? null,
      margenActual: a?.margen ?? null,
      margenProyectado,
      precioNecesario: p?.precioNecesario ?? null,
      ajustePct: p?.ajustePct ?? null,
      riesgoProyectado,
    };
  });

  // ── KPIs ──
  const conCamino = out.filter((r) => r.enCamino > 0 && r.landedEnCamino != null);
  let caminoLanded = 0;
  let caminoActual = 0;
  for (const r of conCamino) {
    if (r.costoActual == null || r.costoActual <= 0) continue;
    caminoLanded += r.enCamino * (r.landedEnCamino ?? 0);
    caminoActual += r.enCamino * r.costoActual;
  }
  const conPrecio = out.filter((r) => r.precioSinIva != null);
  const conMargenProy = conPrecio.filter((r) => r.margenProyectado != null);
  const peorRef = conMargenProy.length
    ? conMargenProy.reduce((peor, r) => ((r.margenProyectado ?? 0) < (peor.margenProyectado ?? 0) ? r : peor))
    : null;

  const kpis: CostoProyectadoKpis = {
    refs: out.length,
    refsConCamino: conCamino.length,
    unidadesEnCamino: out.reduce((s, r) => s + r.enCamino, 0),
    deltaCaminoVsActualPct: caminoActual > 0 ? pct1(caminoLanded, caminoActual) : null,
    refsSuben: out.filter((r) => (r.deltaCaminoVsActualPct ?? 0) > UMBRAL_CAMBIO_PCT).length,
    refsBajan: out.filter((r) => (r.deltaCaminoVsActualPct ?? 0) < -UMBRAL_CAMBIO_PCT).length,
    refsConPrecio: conPrecio.length,
    margenActualPond: resActual.margenPonderado,
    margenProyectadoPond: resProy.margenPonderado,
    refsEnRiesgoProy: out.filter((r) => r.riesgoProyectado === 'riesgo').length,
    refsEnPerdidaProy: out.filter((r) => r.riesgoProyectado === 'perdida').length,
    peorRef,
    ajusteNecesarioPct: resProy.ajusteNecesarioPct,
  };

  // Lo que viene primero (más unidades en camino), después el resto por referencia.
  out.sort((a, b) => b.enCamino - a.enCamino || a.reference.localeCompare(b.reference));
  return { refs: out, kpis };
}
