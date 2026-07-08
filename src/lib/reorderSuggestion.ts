/**
 * Motor de sugerencia "¿cuándo montar el próximo pedido?" del módulo de
 * importaciones. Todo sale de datos vivos y se recalcula en cada render:
 * cuantos más ciclos completos y más ventas registradas, más preciso.
 *
 *   fecha límite = fecha de quiebre de stock − lead time − colchón de seguridad
 *
 * 1. LEAD TIME SEGMENTADO — en vez de exigir un ciclo completo (hoy no hay
 *    ninguno), cada etapa se mide por separado con las fechas reales de TODOS
 *    los pedidos, incluso los que van por la mitad:
 *      producción      = fecha_anticipo  → fecha_embarque
 *      tránsito        = fecha_embarque  → fecha_arribo_real
 *      nacionalización = fecha_arribo_real → fecha de estado 'entregado'
 *    Si una etapa no tiene datos todavía, usa un default conservador marcado
 *    como "estimado" — apenas un pedido complete esa etapa, el promedio
 *    medido reemplaza al default automáticamente.
 *
 * 2. QUIEBRE DE STOCK — consumo diario por referencia (salidas de inventario
 *    de los últimos N días) contra stock físico actual + llegadas en tránsito
 *    (packing list de pedidos abiertos, a su ETA + nacionalización). La fecha
 *    crítica es el primer quiebre entre las referencias que concentran el
 *    grueso del consumo (evita que una referencia marginal dispare la alarma).
 *
 * 3. COLCHÓN — días de seguridad fijos (SAFETY_DIAS) para absorber demoras.
 */

// ── Constantes del modelo ──────────────────────────────────────────────────

/** Ventana de consumo: salidas de los últimos N días. */
export const CONSUMO_VENTANA_DIAS = 90;
/** Colchón de seguridad sobre la fecha límite. */
export const SAFETY_DIAS = 15;
/** Cobertura de consumo que define las referencias "críticas" (80%). */
export const CONSUMO_CRITICO_PCT = 0.8;
/**
 * El pedido se dispara cuando esta cantidad de referencias críticas quiebra —
 * UNA sola referencia quebrando es alerta puntual (se resuelve con reposición
 * local o parcial), no motivo para montar un contenedor (decisión de Nico).
 */
export const UMBRAL_REFS_QUIEBRE = 3;
/** Defaults conservadores por etapa (días) mientras no haya datos medidos. */
export const DEFAULT_ETAPAS = { produccion: 35, transito: 40, nacionalizacion: 10 } as const;
/** Duración sana máxima de una etapa (descarta fechas basura). */
const MAX_DIAS_ETAPA = 365;
/** Horizonte máximo de proyección de stock. */
const MAX_HORIZONTE_DIAS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Tipos de entrada (shapes mínimos, desacoplados de la BD) ──────────────

export interface ImportFechas {
  estado: string;
  fecha_anticipo: string | null;
  fecha_embarque: string | null;
  fecha_estimada_llegada: string | null;
  fecha_arribo_real: string | null;
  /** Fecha en que entró a 'entregado' (de import_estado_history). */
  fecha_entregado?: string | null;
}

export interface StockRow {
  productId: string;
  reference: string;
  stockPhysical: number;
  /** Llave de cruce con las llegadas en tránsito. Default: reference
   *  normalizada. El caller pasa la FAMILIA (refFamilyKey) para que la base
   *  del packing list (LIV-40 + colores) cruce con la -5 del inventario. */
  matchKey?: string;
}

export interface SalidaRow {
  productId: string;
  quantity: number;
}

export interface TransitoItem {
  /** Referencia del packing list (se cruza con inventory_products.reference). */
  reference: string;
  cantidad: number;
  /** Fecha estimada de disponibilidad EN BODEGA (ETA + nacionalización). */
  fechaDisponible: string;
  /** Ver StockRow.matchKey. */
  matchKey?: string;
}

// ── Salidas del motor ──────────────────────────────────────────────────────

export interface EtapaEstimate {
  dias: number;
  /** 'medido' = promedio de fechas reales; 'default' = sin datos aún. */
  fuente: 'medido' | 'default';
  /** Cuántos pedidos aportaron datos a esta etapa. */
  n: number;
}

export interface LeadTimeEstimate {
  produccion: EtapaEstimate;
  transito: EtapaEstimate;
  nacionalizacion: EtapaEstimate;
  totalDias: number;
  /** true si al menos una etapa sigue en default. */
  tieneDefaults: boolean;
}

export interface QuiebreProducto {
  reference: string;
  consumoDiario: number;
  stock: number;
  /** Unidades conocidas en camino (packing/proforma de pedidos abiertos). */
  enTransito: number;
  /** ISO; null = no quiebra dentro del horizonte. */
  fechaQuiebre: string | null;
  diasCobertura: number | null;
}

export interface ReorderSuggestion {
  /** Fecha límite para montar el pedido (ISO); null si faltan datos o no hay
   *  quiebre grupal (menos de UMBRAL_REFS_QUIEBRE referencias críticas quiebran). */
  fechaLimite: string | null;
  diasParaDecidir: number | null;
  /** Fecha del quiebre GRUPAL: cuando quiebra la referencia número UMBRAL. */
  fechaQuiebreGrupal: string | null;
  /** Las referencias que quiebran hasta la fecha grupal (definen el pedido). */
  refsGrupal: QuiebreProducto[];
  /** Quiebres puntuales que NO disparan pedido (menos que el umbral, o
   *  anteriores a la fecha grupal): alertas para reposición local/parcial. */
  alertas: QuiebreProducto[];
  /** Si montás un pedido HOY, fecha estimada de disponibilidad en bodega. */
  llegadaSiPidoHoy: string;
  /** Detalle de las referencias críticas (para la tabla del card). */
  criticos: QuiebreProducto[];
  /** TODAS las referencias con consumo (para el análisis de cobertura). */
  porReferencia: QuiebreProducto[];
  leadTime: LeadTimeEstimate;
  safetyDias: number;
  umbralRefs: number;
  /** Datos que alimentaron el cálculo (transparencia / confianza). */
  datos: {
    referenciasConConsumo: number;
    ventanaDias: number;
    llegadasEnTransito: number;
  };
  /** null = ok; si no, por qué no se puede sugerir fecha. */
  motivoSinFecha: 'sin_consumo' | 'sin_stock_data' | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function daysBetween(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso + 'T00:00:00Z').getTime() - new Date(aIso + 'T00:00:00Z').getTime()) / DAY_MS);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function etapa(duraciones: number[], fallback: number): EtapaEstimate {
  const valid = duraciones.filter((d) => d > 0 && d <= MAX_DIAS_ETAPA);
  if (!valid.length) return { dias: fallback, fuente: 'default', n: 0 };
  return { dias: Math.round(avg(valid)), fuente: 'medido', n: valid.length };
}

// ── 1. Lead time segmentado ────────────────────────────────────────────────

export function estimateLeadTime(imports: ImportFechas[]): LeadTimeEstimate {
  const produccion: number[] = [];
  const transito: number[] = [];
  const nacionalizacion: number[] = [];

  for (const r of imports) {
    if (r.estado === 'cancelado') continue;
    if (r.fecha_anticipo && r.fecha_embarque) {
      produccion.push(daysBetween(r.fecha_anticipo, r.fecha_embarque));
    }
    if (r.fecha_embarque && r.fecha_arribo_real) {
      transito.push(daysBetween(r.fecha_embarque, r.fecha_arribo_real));
    }
    if (r.fecha_arribo_real && r.fecha_entregado) {
      nacionalizacion.push(daysBetween(r.fecha_arribo_real, r.fecha_entregado));
    }
  }

  const p = etapa(produccion, DEFAULT_ETAPAS.produccion);
  const t = etapa(transito, DEFAULT_ETAPAS.transito);
  const n = etapa(nacionalizacion, DEFAULT_ETAPAS.nacionalizacion);

  return {
    produccion: p,
    transito: t,
    nacionalizacion: n,
    totalDias: p.dias + t.dias + n.dias,
    tieneDefaults: p.fuente === 'default' || t.fuente === 'default' || n.fuente === 'default',
  };
}

/** Fecha estimada de disponibilidad EN BODEGA de un pedido abierto. */
export function estimateDisponibilidad(
  r: ImportFechas,
  leadTime: LeadTimeEstimate,
  todayIso: string,
): string {
  const nac = leadTime.nacionalizacion.dias;
  // Ya arribó a puerto → solo falta nacionalizar.
  if (r.fecha_arribo_real) {
    const disp = addDays(r.fecha_arribo_real, nac);
    return disp >= todayIso ? disp : todayIso;
  }
  // Tiene ETA a puerto → ETA + nacionalización (si la ETA ya pasó, contar desde hoy).
  if (r.fecha_estimada_llegada) {
    const base = r.fecha_estimada_llegada >= todayIso ? r.fecha_estimada_llegada : todayIso;
    return addDays(base, nac);
  }
  // Embarcado sin ETA → tránsito restante estimado + nacionalización.
  if (r.fecha_embarque) {
    const eta = addDays(r.fecha_embarque, leadTime.transito.dias);
    return addDays(eta >= todayIso ? eta : todayIso, nac);
  }
  // En producción → lead time restante desde el anticipo (o desde hoy).
  const desde = r.fecha_anticipo ?? todayIso;
  const disp = addDays(desde, leadTime.totalDias);
  return disp >= todayIso ? disp : addDays(todayIso, nac);
}

// ── 2. Proyección de quiebre por referencia ────────────────────────────────

export function projectQuiebres(params: {
  todayIso: string;
  stock: StockRow[];
  salidas: SalidaRow[];
  ventanaDias?: number;
  transito: TransitoItem[];
  /** Consumo diario por productId ya calculado aguas arriba (ej. censurado
   *  por días con stock — demandModel). Si falta, salidas ÷ ventana. */
  consumoPorProducto?: Map<string, number>;
}): QuiebreProducto[] {
  const { todayIso, stock, salidas, transito } = params;
  const ventana = params.ventanaDias ?? CONSUMO_VENTANA_DIAS;

  const salidasPorProducto = new Map<string, number>();
  for (const s of salidas) {
    salidasPorProducto.set(s.productId, (salidasPorProducto.get(s.productId) ?? 0) + Math.abs(Number(s.quantity ?? 0)));
  }

  // Llegadas en tránsito por llave de cruce (familia si el caller la pasa;
  // si no, la referencia normalizada).
  const llegadasPorRef = new Map<string, { fecha: string; qty: number }[]>();
  for (const t of transito) {
    const key = t.matchKey ?? t.reference.trim().toLowerCase();
    const arr = llegadasPorRef.get(key) ?? [];
    arr.push({ fecha: t.fechaDisponible, qty: Number(t.cantidad ?? 0) });
    llegadasPorRef.set(key, arr);
  }

  const out: QuiebreProducto[] = [];
  for (const p of stock) {
    const totalSalidas = salidasPorProducto.get(p.productId) ?? 0;
    const consumoDiario = params.consumoPorProducto?.get(p.productId) ?? (totalSalidas / ventana);
    if (consumoDiario <= 0) continue;

    // Caminar la línea de tiempo: stock se agota a ritmo constante; cada
    // llegada en tránsito repone ANTES de contar el quiebre si cae a tiempo.
    const llegadas = [...(llegadasPorRef.get(p.matchKey ?? p.reference.trim().toLowerCase()) ?? [])]
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const enTransito = llegadas.reduce((s, l) => s + l.qty, 0);
    let disponible = Math.max(0, Number(p.stockPhysical ?? 0));
    let cursor = todayIso;
    let fechaQuiebre: string | null = null;

    // +1 iteración final sin llegadas pendientes. Congelado ANTES del loop:
    // los shift() de adentro encogen llegadas.length.
    const maxIter = llegadas.length + 1;
    for (let guard = 0; guard < maxIter; guard++) {
      const agotaEn = disponible / consumoDiario; // días desde cursor
      const fechaAgote = addDays(cursor, Math.floor(agotaEn));
      const proxima = llegadas[0];
      if (proxima && proxima.fecha <= fechaAgote) {
        // La llegada cae antes del agote: consumir hasta esa fecha y reponer.
        const diasHasta = Math.max(0, daysBetween(cursor, proxima.fecha));
        disponible = Math.max(0, disponible - diasHasta * consumoDiario) + proxima.qty;
        cursor = proxima.fecha;
        llegadas.shift();
        continue;
      }
      fechaQuiebre = fechaAgote;
      break;
    }

    if (fechaQuiebre && daysBetween(todayIso, fechaQuiebre) > MAX_HORIZONTE_DIAS) {
      fechaQuiebre = null; // fuera de horizonte: no es urgente
    }

    out.push({
      reference: p.reference,
      consumoDiario,
      stock: Number(p.stockPhysical ?? 0),
      enTransito,
      fechaQuiebre,
      diasCobertura: fechaQuiebre ? daysBetween(todayIso, fechaQuiebre) : null,
    });
  }

  return out.sort((a, b) => b.consumoDiario - a.consumoDiario);
}

// ── 3. Sugerencia final ────────────────────────────────────────────────────

export function computeReorderSuggestion(params: {
  todayIso: string;
  imports: ImportFechas[];
  stock: StockRow[];
  salidas: SalidaRow[];
  transito: TransitoItem[];
  ventanaDias?: number;
  safetyDias?: number;
  umbralRefs?: number;
  consumoPorProducto?: Map<string, number>;
}): ReorderSuggestion {
  const { todayIso, imports, stock, salidas, transito } = params;
  const safetyDias = params.safetyDias ?? SAFETY_DIAS;
  const umbralRefs = params.umbralRefs ?? UMBRAL_REFS_QUIEBRE;

  const leadTime = estimateLeadTime(imports);
  const quiebres = projectQuiebres({
    todayIso, stock, salidas, transito, ventanaDias: params.ventanaDias,
    consumoPorProducto: params.consumoPorProducto,
  });

  const base = {
    leadTime,
    safetyDias,
    umbralRefs,
    llegadaSiPidoHoy: addDays(todayIso, leadTime.totalDias),
    datos: {
      referenciasConConsumo: quiebres.length,
      ventanaDias: params.ventanaDias ?? CONSUMO_VENTANA_DIAS,
      llegadasEnTransito: transito.length,
    },
  };
  const vacio = {
    fechaLimite: null, diasParaDecidir: null, fechaQuiebreGrupal: null,
    refsGrupal: [], alertas: [], criticos: [] as QuiebreProducto[],
    porReferencia: [] as QuiebreProducto[],
  };

  if (!stock.length) {
    return { ...base, ...vacio, motivoSinFecha: 'sin_stock_data' };
  }
  if (!quiebres.length) {
    return { ...base, ...vacio, motivoSinFecha: 'sin_consumo' };
  }

  // Referencias críticas: las que concentran el 80% del consumo diario.
  // Una referencia marginal (1 unidad/mes) no debe disparar el pedido.
  const consumoTotal = quiebres.reduce((s, q) => s + q.consumoDiario, 0);
  const criticos: QuiebreProducto[] = [];
  let acumulado = 0;
  for (const q of quiebres) {
    criticos.push(q);
    acumulado += q.consumoDiario;
    if (acumulado >= consumoTotal * CONSUMO_CRITICO_PCT) break;
  }

  // El pedido se dispara con el quiebre GRUPAL: la fecha en que quiebra la
  // referencia número `umbralRefs` (ordenadas por fecha de quiebre). Una o
  // dos referencias quebrando antes son ALERTAS puntuales, no pedido.
  const conQuiebre = criticos
    .filter((q) => q.fechaQuiebre != null)
    .sort((a, b) => a.fechaQuiebre!.localeCompare(b.fechaQuiebre!));

  if (conQuiebre.length < umbralRefs) {
    return {
      ...base, ...vacio,
      alertas: conQuiebre,
      criticos,
      porReferencia: quiebres,
      motivoSinFecha: null,
    };
  }

  const refsGrupal = conQuiebre.slice(0, umbralRefs);
  const fechaQuiebreGrupal = refsGrupal[umbralRefs - 1].fechaQuiebre!;
  const fechaLimite = addDays(fechaQuiebreGrupal, -(leadTime.totalDias + safetyDias));

  return {
    ...base,
    fechaLimite,
    diasParaDecidir: daysBetween(todayIso, fechaLimite),
    fechaQuiebreGrupal,
    refsGrupal,
    // Quiebres anteriores a la fecha grupal que conviene vigilar puntualmente.
    alertas: conQuiebre.filter((q) => q.fechaQuiebre! < fechaQuiebreGrupal),
    criticos,
    porReferencia: quiebres,
    motivoSinFecha: null,
  };
}

/**
 * ¿Cuánto pedir de una referencia en el PRÓXIMO pedido?
 *
 *   sugerido = consumo diario × horizonte objetivo − (stock + en tránsito)
 *
 * El horizonte objetivo es el tiempo que ese pedido tiene que cubrir:
 * lead time (mientras viaja se consume) + ciclo entre pedidos (hasta que
 * llegue el SIGUIENTE) + colchón. Nunca negativo; redondeado hacia arriba.
 */
export function suggestOrderQty(q: QuiebreProducto, horizonteDias: number): number {
  const objetivo = q.consumoDiario * horizonteDias;
  const disponible = q.stock + q.enTransito;
  return Math.max(0, Math.ceil(objetivo - disponible));
}
