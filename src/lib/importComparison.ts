/**
 * Comparativo de contenedores: último entregado · los que están pedidos · y
 * "si montara uno hoy".
 *
 * Nico, jul 2026: "quiero ver el actual (último entregado) con respecto a los
 * contenedores que estén pedidos, y a hoy, como si se pidiera uno nuevamente
 * hoy. quiero ver esos vs en los datos que tenemos".
 *
 * Dos ejes en la misma tabla:
 *   · COSTO — qué me costó nacionalizar el kg, y qué me costaría hoy.
 *   · TIEMPO — cuánto tardó cada etapa, y cuándo llegaría lo que pida hoy.
 *
 * La columna "hoy" NO inventa un pedido: toma el último entregado como molde
 * (mismas toneladas, misma estructura de fletes/agencia, mismos % de arancel
 * e IVA) y le cambia SOLO lo que sí sabemos que se movió: el dólar y el
 * aluminio. Todo lo asumido queda declarado en `supuestos` para que la UI lo
 * muestre — un comparativo que no dice qué asumió no sirve para decidir.
 *
 * Funciones puras → testeables sin base de datos.
 */

import { computeImportBreakdown, type ImportCostLine } from '@/lib/importCosting';
import { estimateLeadTime, type ImportFechas, type LeadTimeEstimate } from '@/lib/reorderSuggestion';

export type ColumnaKind = 'entregado' | 'en_curso' | 'hoy';

/** Lo mínimo que necesita el comparativo de cada pedido. */
export interface PedidoComparable {
  id: string;
  label: string;
  estado: string;
  cantidad_ton: number | null;
  precio_smm_cerrado_usd_ton: number | null;
  monto_total_usd: number | null;
  trm: number | null;
  arancel_pct: number | null;
  iva_pct: number | null;
  costs: ImportCostLine[] | undefined;
  fechas: ImportFechas;
}

export interface EtapasDias {
  produccion: number | null;
  transito: number | null;
  nacionalizacion: number | null;
  total: number | null;
  /** true = son promedios del modelo, no medidos en este pedido. */
  estimado: boolean;
}

export interface ColumnaComparativo {
  id: string;
  kind: ColumnaKind;
  label: string;
  sublabel: string;
  estado: string;

  // ── Costo
  toneladas: number | null;
  precioUsdTon: number | null;
  mercanciaUsd: number | null;
  trm: number | null;
  totalCop: number | null;
  /** La métrica que manda: cuánto sale el kg puesto en bodega. */
  copPorKg: number | null;

  // ── Tiempo
  etapas: EtapasDias;
  /** Entregado el (histórico) o llegada estimada (en curso / hoy). */
  fechaLlegada: string | null;
  fechaLlegadaEstimada: boolean;

  /** Qué se asumió para armar esta columna. Vacío en las reales. */
  supuestos: string[];
}

export interface ComparativoResult {
  columnas: ColumnaComparativo[];
  /** Columna contra la que se miden los deltas (el último entregado). */
  baseId: string | null;
  leadTime: LeadTimeEstimate;
  /** Motivo por el que no se pudo armar el comparativo, si aplica. */
  vacio: string | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Duración REAL de cada etapa de un pedido, cuando hay fechas para medirla. */
export function etapasMedidas(f: ImportFechas): EtapasDias {
  const finProduccion = f.fecha_listo_fabrica ?? f.fecha_embarque;
  const produccion = f.fecha_anticipo && finProduccion ? daysBetween(f.fecha_anticipo, finProduccion) : null;
  const transito = f.fecha_embarque && f.fecha_arribo_real ? daysBetween(f.fecha_embarque, f.fecha_arribo_real) : null;
  const nacionalizacion = f.fecha_arribo_real && f.fecha_entregado ? daysBetween(f.fecha_arribo_real, f.fecha_entregado) : null;
  const total = produccion != null && transito != null && nacionalizacion != null
    ? produccion + transito + nacionalizacion
    : null;
  return { produccion, transito, nacionalizacion, total, estimado: false };
}

/**
 * Etapas de un pedido EN CURSO: lo ya medido se respeta, lo que falta se
 * completa con el promedio del modelo. Mezclar así es a propósito — decir
 * "producción: 41 días (real) + tránsito: 32 (promedio)" es más honesto que
 * mostrar todo estimado o dejar huecos.
 */
export function etapasProyectadas(f: ImportFechas, lt: LeadTimeEstimate): EtapasDias {
  const medidas = etapasMedidas(f);
  const produccion = medidas.produccion ?? lt.produccion.dias;
  const transito = medidas.transito ?? lt.transito.dias;
  const nacionalizacion = medidas.nacionalizacion ?? lt.nacionalizacion.dias;
  return {
    produccion,
    transito,
    nacionalizacion,
    total: produccion + transito + nacionalizacion,
    estimado: medidas.produccion == null || medidas.transito == null || medidas.nacionalizacion == null,
  };
}

function costoDe(p: PedidoComparable): { totalCop: number | null; copPorKg: number | null; mercanciaUsd: number | null } {
  const mercanciaUsd = num(p.monto_total_usd);
  const kg = num(p.cantidad_ton) != null ? Number(p.cantidad_ton) * 1000 : null;
  const bd = computeImportBreakdown({
    mercanciaUsd: mercanciaUsd ?? 0,
    costs: p.costs,
    trm: p.trm,
    arancelPct: Number(p.arancel_pct ?? 5),
    ivaPct: Number(p.iva_pct ?? 19),
    cantidadKg: kg,
  });
  const totalCop = bd.totalImportacionCop;
  return {
    mercanciaUsd,
    totalCop,
    copPorKg: totalCop != null && kg ? totalCop / kg : null,
  };
}

function columnaDePedido(p: PedidoComparable, kind: ColumnaKind, lt: LeadTimeEstimate, hoy: string): ColumnaComparativo {
  const { totalCop, copPorKg, mercanciaUsd } = costoDe(p);
  const entregado = kind === 'entregado';
  const etapas = entregado ? etapasMedidas(p.fechas) : etapasProyectadas(p.fechas, lt);

  // Llegada: la real si ya se entregó; si no, hoy + lo que falte del lead time.
  let fechaLlegada: string | null = null;
  let estimada = false;
  if (entregado) {
    fechaLlegada = p.fechas.fecha_entregado ?? p.fechas.fecha_arribo_real ?? null;
  } else {
    const faltan = restanteDias(p.fechas, lt);
    fechaLlegada = addDays(hoy, faltan);
    estimada = true;
  }

  return {
    id: p.id,
    kind,
    label: p.label,
    sublabel: entregado ? 'Último entregado' : 'En curso',
    estado: p.estado,
    toneladas: num(p.cantidad_ton),
    precioUsdTon: num(p.precio_smm_cerrado_usd_ton),
    mercanciaUsd,
    trm: num(p.trm),
    totalCop,
    copPorKg,
    etapas,
    fechaLlegada,
    fechaLlegadaEstimada: estimada,
    supuestos: [],
  };
}

/** Días que le faltan a un pedido para estar en bodega, según dónde va. */
export function restanteDias(f: ImportFechas, lt: LeadTimeEstimate): number {
  const prod = lt.produccion.dias;
  const trans = lt.transito.dias;
  const nac = lt.nacionalizacion.dias;

  if (f.estado === 'aduana' || f.fecha_arribo_real) return nac;
  if (f.estado === 'listo_fabrica') return trans + nac;
  if (f.estado === 'transito' || f.fecha_embarque) return trans + nac;
  if (f.fecha_anticipo) {
    // En producción: descontar lo que ya lleva fabricándose.
    const corridos = daysBetween(f.fecha_anticipo, new Date().toISOString().slice(0, 10));
    return Math.max(0, prod - corridos) + trans + nac;
  }
  return prod + trans + nac;
}

/**
 * Construye la columna "si pidiera hoy" a partir del último entregado.
 *
 * Reglas — cada una existe porque la alternativa mentía:
 *   · Cantidad y estructura de costos: las del molde. Comparar un contenedor
 *     de 25 t contra uno de 18 t por COP/kg escondería el efecto de escala en
 *     los costos fijos (agencia, bancarios).
 *   · Precio del aluminio: se mueve el SMM cerrado del molde por la variación
 *     del LME entre la fecha de ese pedido y hoy. Reemplazarlo por el LME
 *     crudo sería otro índice — el SMM que Nico cierra tiene su propio spread.
 *   · TRM: la de hoy.
 */
export function columnaHoy(
  molde: PedidoComparable,
  lt: LeadTimeEstimate,
  hoy: string,
  opts: { trmHoy: number | null; lmeHoy: number | null; lmeEnFechaMolde: number | null },
): ColumnaComparativo | null {
  const ton = num(molde.cantidad_ton);
  const precioMolde = num(molde.precio_smm_cerrado_usd_ton);
  const supuestos: string[] = [];

  let precioHoy = precioMolde;
  if (precioMolde != null && opts.lmeHoy != null && opts.lmeEnFechaMolde != null && opts.lmeEnFechaMolde > 0) {
    const factor = opts.lmeHoy / opts.lmeEnFechaMolde;
    precioHoy = precioMolde * factor;
    const pct = (factor - 1) * 100;
    supuestos.push(
      `Precio del aluminio: tu SMM de ${Math.round(precioMolde)} USD/ton movido ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% según el LME desde ese pedido.`,
    );
  } else if (precioMolde != null) {
    supuestos.push('Precio del aluminio: el mismo del último pedido (no hay LME para comparar contra esa fecha).');
  }

  const trm = opts.trmHoy ?? molde.trm;
  if (opts.trmHoy == null) supuestos.push('TRM: la del último pedido (no hay TRM de hoy cargada).');

  // Mercancía: si hay precio y toneladas la recalculamos; si no, la del molde.
  const mercanciaUsd = precioHoy != null && ton != null ? precioHoy * ton : num(molde.monto_total_usd);
  if (precioHoy == null || ton == null) {
    supuestos.push('Mercancía: el monto del último pedido (falta precio o toneladas para recalcular).');
  }

  if (mercanciaUsd == null) return null;

  supuestos.push(`Cantidad: las mismas ${ton != null ? `${ton} t` : 'toneladas'} del último pedido.`);
  supuestos.push('Flete, seguro, agencia y bancarios: los del último pedido (no hay cotización nueva).');
  supuestos.push(`Tiempos: promedio de tus pedidos (${lt.totalDias} días de producción a bodega).`);

  const kg = ton != null ? ton * 1000 : null;
  const bd = computeImportBreakdown({
    mercanciaUsd,
    costs: molde.costs,
    trm,
    arancelPct: Number(molde.arancel_pct ?? 5),
    ivaPct: Number(molde.iva_pct ?? 19),
    cantidadKg: kg,
  });
  const totalCop = bd.totalImportacionCop;

  return {
    id: 'hoy',
    kind: 'hoy',
    label: 'Si pido hoy',
    sublabel: 'Simulación',
    estado: 'simulado',
    toneladas: ton,
    precioUsdTon: precioHoy,
    mercanciaUsd,
    trm: num(trm),
    totalCop,
    copPorKg: totalCop != null && kg ? totalCop / kg : null,
    etapas: {
      produccion: lt.produccion.dias,
      transito: lt.transito.dias,
      nacionalizacion: lt.nacionalizacion.dias,
      total: lt.totalDias,
      estimado: true,
    },
    fechaLlegada: addDays(hoy, lt.totalDias),
    fechaLlegadaEstimada: true,
    supuestos,
  };
}

export function buildComparativo(params: {
  pedidos: PedidoComparable[];
  hoy: string;
  trmHoy: number | null;
  lmeHoy: number | null;
  /** Serie LME ascendente para ubicar el valor en la fecha del molde. */
  lmeHistoria: Array<{ date: string; value: number }>;
}): ComparativoResult {
  const { pedidos, hoy, trmHoy, lmeHoy, lmeHistoria } = params;

  const vivos = pedidos.filter((p) => p.estado !== 'cancelado');
  const leadTime = estimateLeadTime(vivos.map((p) => p.fechas));

  const entregados = vivos
    .filter((p) => p.estado === 'entregado' || p.estado === 'cerrado')
    .sort((a, b) => (b.fechas.fecha_entregado ?? '').localeCompare(a.fechas.fecha_entregado ?? ''));
  const ultimo = entregados[0] ?? null;

  const enCurso = vivos
    .filter((p) => p.estado !== 'entregado' && p.estado !== 'cerrado')
    .sort((a, b) => restanteDias(a.fechas, leadTime) - restanteDias(b.fechas, leadTime));

  if (!ultimo && enCurso.length === 0) {
    return { columnas: [], baseId: null, leadTime, vacio: 'Todavía no hay pedidos para comparar.' };
  }

  const columnas: ColumnaComparativo[] = [];
  if (ultimo) columnas.push(columnaDePedido(ultimo, 'entregado', leadTime, hoy));
  for (const p of enCurso) columnas.push(columnaDePedido(p, 'en_curso', leadTime, hoy));

  if (ultimo) {
    const fechaMolde = ultimo.fechas.fecha_entregado ?? ultimo.fechas.fecha_anticipo ?? null;
    const lmeEnFechaMolde = fechaMolde ? valorEnFecha(lmeHistoria, fechaMolde) : null;
    const hoyCol = columnaHoy(ultimo, leadTime, hoy, { trmHoy, lmeHoy, lmeEnFechaMolde });
    if (hoyCol) columnas.push(hoyCol);
  }

  return {
    columnas,
    baseId: ultimo?.id ?? null,
    leadTime,
    vacio: ultimo ? null : 'Falta un pedido entregado para poder comparar contra "si pido hoy".',
  };
}

/** Valor de la serie en la fecha dada (el punto más cercano hacia atrás). */
export function valorEnFecha(
  serie: Array<{ date: string; value: number }>,
  fecha: string,
): number | null {
  let mejor: number | null = null;
  for (const p of serie) {
    if (p.date <= fecha) mejor = p.value;
    else break;
  }
  // Si la serie arranca después de la fecha, el primer punto es lo más cerca
  // que tenemos — mejor eso que no comparar.
  if (mejor == null && serie.length > 0) return serie[0].value;
  return mejor;
}

/** Delta % de una columna contra la base. null si falta algún lado. */
export function deltaPct(valor: number | null, base: number | null): number | null {
  if (valor == null || base == null || base === 0) return null;
  return ((valor - base) / base) * 100;
}
