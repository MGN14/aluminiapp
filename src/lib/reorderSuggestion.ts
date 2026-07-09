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
/** @deprecated Ya no filtra el umbral: todas las refs con consumo cuentan
 *  (el filtro del 80% escondía referencias en quiebre — bug de la fecha 2037). */
export const CONSUMO_CRITICO_PCT = 0.8;
/**
 * El pedido se dispara cuando esta cantidad de referencias críticas quiebra —
 * UNA sola referencia quebrando es alerta puntual (se resuelve con reposición
 * local o parcial), no motivo para montar un contenedor (decisión de Nico).
 */
export const UMBRAL_REFS_QUIEBRE = 3;
/**
 * …y además las refs quebrando tienen que concentrar esta fracción del
 * consumo diario total: el GRUESO, no un conteo. 3 referencias marginales
 * quebrando en octubre no ameritan contenedor recién comprometidos 3
 * contenedores (caso real de Nico, jul 2026) — son alerta/candidatas al
 * próximo pedido. El contenedor se monta cuando se viene el volumen.
 */
export const UMBRAL_CONSUMO_GRUPAL_PCT = 0.2;
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
  /** ISO; null = no quiebra dentro del horizonte (ver teórica). */
  fechaQuiebre: string | null;
  diasCobertura: number | null;
  /** Fecha de agote SIN tope de horizonte — siempre existe si hay consumo.
   *  Con ella la fecha de pedido es concreta aunque no haya urgencia. */
  fechaQuiebreTeorica?: string | null;
  /** Primer día en que el stock toca 0 ANTES de que nacionalice una llegada
   *  que ya viene en camino: hueco operativo corto (alerta), NO disparador de
   *  pedido — ese contenedor ya está en el agua y repone. null = sin hueco. */
  fechaHueco?: string | null;
  /** true = sin salidas registradas en la ventana: no hay tasa de consumo.
   *  Antes estas referencias se OCULTABAN del análisis (por eso "cobertura
   *  muestra 15 de 126"); ahora aparecen marcadas, con su stock y tránsito. */
  sinConsumo?: boolean;
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
  /** Quiebres ALCANZABLES pero anteriores al grupal: no son masa suficiente
   *  para disparar contenedor — candidatas a reposición local o a sumarse al
   *  próximo pedido (quedarían secas hasta que llegue el pedido grupal). */
  alertas: QuiebreProducto[];
  /** FALTANTES REALES: refs cuyo agote FINAL (con todo el pipeline sumado)
   *  cae ANTES de que llegue un pedido montado hoy — un pedido nuevo no las
   *  alcanza. Salida: reposición local o apurar; NO mueven la fecha límite. */
  faltantes: QuiebreProducto[];
  /** Huecos operativos: refs que quedan en 0 unos días hasta que nacionaliza
   *  lo que YA viene en camino. Vigilancia puntual, no disparan pedido. */
  huecos: QuiebreProducto[];
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

/** Fecha estimada de disponibilidad EN BODEGA de un pedido abierto — por
 *  FASE: cada contenedor repone según dónde va (aduana ≈ solo nacionalizar;
 *  producción ≈ producción restante + tránsito + nacionalización). */
export function estimateDisponibilidad(
  r: ImportFechas,
  leadTime: LeadTimeEstimate,
  todayIso: string,
): string {
  const nac = leadTime.nacionalizacion.dias;
  const trans = leadTime.transito.dias;

  // En ADUANA: ya está en puerto aunque no hayan cargado fecha_arribo_real —
  // solo falta nacionalizar (el contenedor "de 15 días" de Nico).
  if (r.estado === 'aduana') {
    const base = r.fecha_arribo_real && r.fecha_arribo_real >= todayIso ? r.fecha_arribo_real : todayIso;
    return addDays(base, nac);
  }
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
    const eta = addDays(r.fecha_embarque, trans);
    return addDays(eta >= todayIso ? eta : todayIso, nac);
  }
  // En producción → lead time restante desde el anticipo. Si viene atrasado
  // (anticipo + lead ya pasó), lo MÍNIMO que falta es tránsito + nacionalización
  // — antes caía a hoy+nac, como si un pedido aún en fábrica llegara en 10 días.
  const desde = r.fecha_anticipo ?? todayIso;
  const disp = addDays(desde, leadTime.totalDias);
  const piso = addDays(todayIso, trans + nac);
  return disp >= piso ? disp : piso;
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

    // Caminar la línea de tiempo: stock se agota a ritmo constante; cada
    // llegada en tránsito repone ANTES de contar el quiebre si cae a tiempo.
    const llegadas = [...(llegadasPorRef.get(p.matchKey ?? p.reference.trim().toLowerCase()) ?? [])]
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const enTransito = llegadas.reduce((s, l) => s + l.qty, 0);

    if (consumoDiario <= 0) {
      // Sin salidas en la ventana → no hay tasa para proyectar quiebre, pero
      // la referencia EXISTE y debe verse (con su stock y su tránsito). No
      // dispara pedido sugerido (suggestOrderQty con consumo 0 devuelve 0).
      out.push({
        reference: p.reference,
        consumoDiario: 0,
        stock: Math.max(0, Number(p.stockPhysical ?? 0)),
        enTransito,
        fechaQuiebre: null,
        diasCobertura: null,
        sinConsumo: true,
      });
      continue;
    }
    let disponible = Math.max(0, Number(p.stockPhysical ?? 0));
    let cursor = todayIso;
    // Primer hueco: stock en 0 ANTES de que entre una reposición en camino.
    let fechaHueco: string | null = null;

    // Se procesan TODAS las llegadas en orden. Cada una repone AUNQUE caiga
    // después del agote — lo que está en el agua cuenta siempre. Antes, si una
    // llegada caía un día tarde, el motor "se rendía" (fechaQuiebre = agote,
    // break) e ignoraba el contenedor que ya venía en camino: de ahí la fecha
    // de pedido alarmista en el pasado ("no lee lo que ya viene en camino").
    for (const proxima of llegadas) {
      const agotaEn = disponible / consumoDiario; // días desde cursor
      const fechaAgote = addDays(cursor, Math.floor(agotaEn));
      if (proxima.fecha <= fechaAgote) {
        // Llega antes de agotarse: consumir hasta esa fecha y reponer.
        const diasHasta = Math.max(0, daysBetween(cursor, proxima.fecha));
        disponible = disponible - diasHasta * consumoDiario + proxima.qty;
      } else {
        // Llega DESPUÉS del agote: hay un hueco (stock en 0 hasta que
        // nacionaliza). Es alerta operativa, no pedido — igual repone.
        if (!fechaHueco) fechaHueco = fechaAgote;
        disponible = proxima.qty;
      }
      cursor = proxima.fecha;
    }

    // Agote FINAL: cuando se consume lo último que queda tras la última
    // llegada. Con todo el tránsito ya sumado, esta es la fecha real para el
    // próximo pedido. Nunca es anterior a hoy (disponible ≥ 0 en cada paso).
    let fechaQuiebre: string | null = addDays(cursor, Math.floor(disponible / consumoDiario));
    const fechaQuiebreTeorica = fechaQuiebre; // sin tope: la fecha real de agote
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
      fechaQuiebreTeorica,
      fechaHueco,
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
  umbralConsumoPct?: number;
  consumoPorProducto?: Map<string, number>;
}): ReorderSuggestion {
  const { todayIso, imports, stock, salidas, transito } = params;
  const safetyDias = params.safetyDias ?? SAFETY_DIAS;
  const umbralRefs = params.umbralRefs ?? UMBRAL_REFS_QUIEBRE;
  const umbralConsumoPct = params.umbralConsumoPct ?? UMBRAL_CONSUMO_GRUPAL_PCT;

  const leadTime = estimateLeadTime(imports);
  const quiebres = projectQuiebres({
    todayIso, stock, salidas, transito, ventanaDias: params.ventanaDias,
    consumoPorProducto: params.consumoPorProducto,
  });

  // Las filas sinConsumo se muestran en Cobertura pero NO participan del
  // modelo de pedido (no tienen tasa para proyectar quiebre).
  const conConsumo = quiebres.filter((q) => !q.sinConsumo);

  const base = {
    leadTime,
    safetyDias,
    umbralRefs,
    llegadaSiPidoHoy: addDays(todayIso, leadTime.totalDias),
    datos: {
      referenciasConConsumo: conConsumo.length,
      ventanaDias: params.ventanaDias ?? CONSUMO_VENTANA_DIAS,
      llegadasEnTransito: transito.length,
    },
  };
  const vacio = {
    fechaLimite: null, diasParaDecidir: null, fechaQuiebreGrupal: null,
    refsGrupal: [], alertas: [], faltantes: [] as QuiebreProducto[],
    huecos: [] as QuiebreProducto[],
    criticos: [] as QuiebreProducto[],
    porReferencia: [] as QuiebreProducto[],
  };

  if (!stock.length) {
    return { ...base, ...vacio, motivoSinFecha: 'sin_stock_data' };
  }
  if (!conConsumo.length) {
    // Sin tasa de consumo en NINGUNA referencia: no hay pedido que proyectar,
    // pero el inventario igual se lista en Cobertura (filas sinConsumo).
    return { ...base, ...vacio, porReferencia: quiebres, motivoSinFecha: 'sin_consumo' };
  }

  // TODAS las refs con consumo cuentan para el umbral. Antes solo las que
  // concentraban el 80% del consumo — eso hacía que varias referencias en
  // 0 días de cobertura no movieran la fecha y el grupal se fuera a años
  // (bug reportado por Nico: "quiebre el 9 de abril y me dice que monte
  // pedido en 2037"). La protección contra marginales es el UMBRAL de 3
  // referencias, no el filtro de consumo.
  const criticos: QuiebreProducto[] = conConsumo;

  // El pedido se dispara con el quiebre GRUPAL: la fecha en que quiebra la
  // referencia número `umbralRefs` (ordenadas por fecha de quiebre). Una o
  // dos referencias quebrando antes son ALERTAS puntuales, no pedido.
  //
  // La fecha grupal usa las fechas TEÓRICAS (sin tope de horizonte): la card
  // SIEMPRE da una fecha concreta para montar pedido — si el stock sobra, la
  // fecha simplemente queda lejos y en verde (decisión de Nico: una card de
  // planeación sin fecha no planifica nada). Si hay menos referencias
  // críticas que el umbral, manda la última que quiebre.
  // ── El ancla: solo quiebres ALCANZABLES por un pedido nuevo ──────────────
  // Un pedido montado HOY llega a bodega en llegadaSiPidoHoy (hoy + lead).
  // Un quiebre ANTERIOR a esa fecha es físicamente imposible de cubrir con un
  // pedido nuevo: es un FALTANTE REAL (reposición local / apurar), no un
  // disparador. Anclar la fecha a esos quiebres daba fechas en el pasado
  // ("montá pedido el 5 de mayo" estando en julio) — inútil para planear.
  const llegadaSiPidoHoy = base.llegadaSiPidoHoy;
  const teoricas = criticos
    .filter((q) => q.fechaQuiebreTeorica != null)
    .sort((a, b) => a.fechaQuiebreTeorica!.localeCompare(b.fechaQuiebreTeorica!));
  const alcanzables = teoricas.filter((q) => q.fechaQuiebreTeorica! >= llegadaSiPidoHoy);
  const faltantes = teoricas.filter((q) => q.fechaQuiebreTeorica! < llegadaSiPidoHoy);

  // Huecos operativos (quedan en 0 unos días hasta que nacionaliza lo que YA
  // viene): vigilancia, no pedido. Los faltantes reales van en su propia
  // lista con mensaje más fuerte — acá no se repiten.
  const enFaltantes = new Set(faltantes.map((q) => q.reference));
  const conHueco = criticos
    .filter((q) => q.fechaHueco != null && !enFaltantes.has(q.reference))
    .sort((a, b) => (a.fechaHueco ?? '').localeCompare(b.fechaHueco ?? ''));

  if (!teoricas.length) {
    return {
      ...base, ...vacio,
      huecos: conHueco,
      criticos,
      porReferencia: quiebres,
      motivoSinFecha: null,
    };
  }

  // ── Grupal por MASA DE CONSUMO, no por conteo ────────────────────────────
  // El contenedor se monta cuando se viene EL GRUESO: caminar los quiebres
  // alcanzables en orden acumulando consumo diario; el grupal es la fecha en
  // que lo quebrado acumula ≥ umbralConsumoPct del consumo total (y al menos
  // umbralRefs referencias). 3 refs marginales quebrando temprano NO adelantan
  // el contenedor (caso real: "montá hoy" con 3 contenedores recién
  // comprometidos por 3 refs que no venían en ellos) — quedan como alertas.
  // Si NADA es alcanzable (todo quiebra antes de que llegue un pedido montado
  // hoy), la única respuesta es montar YA: límite = hoy.
  const pool = alcanzables.length ? alcanzables : teoricas;
  const consumoTotal = criticos.reduce((s, q) => s + q.consumoDiario, 0);
  const minRefs = Math.min(umbralRefs, pool.length);
  let corte = pool.length - 1; // fallback: la última que quiebre
  let acumulado = 0;
  for (let i = 0; i < pool.length; i++) {
    acumulado += pool[i].consumoDiario;
    if (i + 1 >= minRefs && consumoTotal > 0 && acumulado / consumoTotal >= umbralConsumoPct) {
      corte = i;
      break;
    }
  }
  const refsGrupal = pool.slice(0, corte + 1);
  const fechaQuiebreGrupal = pool[corte].fechaQuiebreTeorica!;
  // Nunca en el pasado: si el cálculo cae antes de hoy, la decisión es "hoy".
  const fechaLimiteCruda = addDays(fechaQuiebreGrupal, -(leadTime.totalDias + safetyDias));
  const fechaLimite = fechaLimiteCruda >= todayIso ? fechaLimiteCruda : todayIso;

  // Alertas: quiebres alcanzables ANTERIORES al grupal — no son masa para
  // disparar contenedor, pero quedarían secas hasta que llegue el pedido:
  // reposición local o sumarlas al próximo pedido.
  const alertas = alcanzables.filter((q) => q.fechaQuiebreTeorica! < fechaQuiebreGrupal);
  // Una ref con alerta no se repite en huecos (la alerta es el mensaje fuerte).
  const enAlertas = new Set(alertas.map((q) => q.reference));
  const huecos = conHueco.filter((q) => !enAlertas.has(q.reference));

  return {
    ...base,
    fechaLimite,
    diasParaDecidir: daysBetween(todayIso, fechaLimite),
    fechaQuiebreGrupal,
    refsGrupal,
    alertas,
    faltantes,
    huecos,
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
