/**
 * HISTORIAL DE CONCILIACIÓN — la memoria de cómo Nico ha clasificado siempre.
 *
 * Pedido de Nico (2026-08-06): reducir errores humanos en la conciliación con
 * tres piezas sobre el MISMO índice:
 *   1. Sugerir el beneficiario a partir de categoría + monto ("Nómina de
 *      $1.250.000 → Rocío Gaitán, 7 de 7 veces").
 *   2. Alertar (sin bloquear) cuando una clasificación se sale de lo
 *      histórico ("Spotify fue Servicios 6 de 7 veces y elegiste Otros").
 *   3. Proponer reglas cuando un patrón es firme, para que la app concilie
 *      sola la próxima vez (cierra el ciclo con reconciliation_rules).
 *
 * La descripción del banco NO alcanza para clasificar ("Transferencia Cta Suc
 * Virtual" tiene 6 categorías distintas en el histórico real) — por eso el
 * índice cruza descripción, categoría, beneficiario Y monto.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeForMatch } from '@/lib/stringUtils';
import type { ReconciliationRule, NewReconciliationRule } from '@/hooks/useReconciliationRules';

export interface TxHistorial {
  /** Presente cuando viene de la base (la auditoría corrige por id). */
  id?: string;
  description: string | null;
  amount: number | null;
  date: string;
  category_id: string | null;
  responsible_id: string | null;
}

interface StatsDesc {
  total: number;
  categorias: Map<string, number>;
  responsables: Map<string, number>;
  /** Combinación exacta cat|resp → veces (para proponer reglas). */
  combos: Map<string, number>;
}

interface StatsCatResp {
  n: number;
  montos: number[]; // absolutos
  /** Cada pago con su fecha y monto (para saber si en ESTE período ya cobró). */
  pagos: PagoHistorial[];
  /** Descripciones normalizadas → veces (para el keyword de la regla). */
  descs: Map<string, number>;
}

export interface PagoHistorial {
  id?: string;
  date: string;
  /** Absoluto. */
  monto: number;
}

export interface HistorialConciliacion {
  txs: TxHistorial[];
  porDesc: Map<string, StatsDesc>;
  /** `${category_id}|${responsible_id}` → stats de montos. */
  porCatResp: Map<string, StatsCatResp>;
  /** category_id → responsible_id → veces. */
  porCategoria: Map<string, Map<string, number>>;
}

const inc = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Los ingresos y los egresos de un mismo tercero son mundos distintos:
 * a Ferromendez le pagás ~$950.000 de gastos Y le vendés $20.000.000. Sin
 * separar por signo, la venta salía marcada como "monto fuera de lo
 * habitual" contra el promedio de los pagos (reporte de Nico 2026-08-08).
 */
export type SignoTx = 'ingreso' | 'egreso';
export const signoDe = (amount: number | null | undefined): SignoTx =>
  Number(amount ?? 0) > 0 ? 'ingreso' : 'egreso';
const claveCatResp = (categoryId: string, responsibleId: string, signo: SignoTx) =>
  `${categoryId}|${responsibleId}|${signo}`;

/** Puro y testeable: arma los índices desde las transacciones ya conciliadas. */
export function indexarHistorial(txs: TxHistorial[]): HistorialConciliacion {
  const porDesc = new Map<string, StatsDesc>();
  const porCatResp = new Map<string, StatsCatResp>();
  const porCategoria = new Map<string, Map<string, number>>();

  for (const t of txs) {
    const desc = normalizeForMatch(t.description ?? '');
    const monto = Math.abs(Number(t.amount ?? 0));

    if (desc) {
      const d = porDesc.get(desc) ?? { total: 0, categorias: new Map(), responsables: new Map(), combos: new Map() };
      d.total++;
      if (t.category_id) inc(d.categorias, t.category_id);
      if (t.responsible_id) inc(d.responsables, t.responsible_id);
      if (t.category_id && t.responsible_id) inc(d.combos, `${t.category_id}|${t.responsible_id}`);
      porDesc.set(desc, d);
    }

    if (t.category_id && t.responsible_id && monto > 0) {
      const key = claveCatResp(t.category_id, t.responsible_id, signoDe(t.amount));
      const s = porCatResp.get(key) ?? { n: 0, montos: [], pagos: [], descs: new Map() };
      s.n++;
      s.montos.push(monto);
      s.pagos.push({ id: t.id, date: (t.date ?? '').slice(0, 10), monto });
      if (desc) inc(s.descs, desc);
      porCatResp.set(key, s);
    }

    if (t.category_id && t.responsible_id) {
      const porResp = porCategoria.get(t.category_id) ?? new Map<string, number>();
      inc(porResp, t.responsible_id);
      porCategoria.set(t.category_id, porResp);
    }
  }
  return { txs, porDesc, porCatResp, porCategoria };
}

/**
 * Devuelve las TRANSACCIONES planas, no el índice: el cache persistente de
 * react-query serializa a JSON y los Map del índice no sobreviven (al
 * recargar quedaba `porDesc.get is not a function`). El índice se arma en
 * memoria con useMemo en useConciliacionHistorial.
 */
export async function fetchHistorialConciliacion(): Promise<TxHistorial[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, description, amount, date, category_id, responsible_id')
    .is('deleted_at', null)
    .or('category_id.not.is.null,responsible_id.not.is.null')
    .order('date', { ascending: false })
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as TxHistorial[];
}

// ── 1. Beneficiario sugerido por categoría + monto ──────────────────────────

export interface SugerenciaBeneficiario {
  responsibleId: string;
  veces: number;
  /** true = el monto de esta transacción calza con los montos históricos. */
  calzaMonto: boolean;
  /** "siempre $1.250.000" o "$641.800–$1.386.751". */
  evidenciaMonto: string;
  /** Fecha del pago IGUAL (misma categoría, mismo monto) que este beneficiario
   *  YA recibió en el período de esta transacción. Si viene, la sugerencia se
   *  baja al final: dos empleadas de $1.000.000 → la segunda fila no vuelve a
   *  proponer a la que ya cobró (pedido de Nico 2026-11-11). null = no cobró
   *  en el período, o no se pasó contexto. */
  yaCobroEl: string | null;
}

/** Contexto de la fila que se está clasificando. Sin él, la sugerencia se
 *  comporta como siempre (solo categoría + monto). */
export interface ContextoSugerencia {
  /** Id de la transacción en cuestión: no cuenta contra sí misma. */
  txId?: string | null;
  /** Fecha de la transacción: define el período. */
  date?: string | null;
  /** Transacciones FRESCAS de la pantalla. El historial cacheado puede no
   *  tener la fila que se acaba de asignar; la lista de la página sí (el
   *  patch optimista). Pisan al historial por id. */
  recientes?: TxHistorial[];
}

const DAY_MS = 86_400_000;
const diasEntre = (a: string, b: string): number =>
  Math.abs(Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / DAY_MS));

/**
 * Ventana de "ya cobró en este período": el 60% del intervalo típico entre
 * sus pagos — quincenal (15d) ≈ 9 días, mensual (30d) ≈ 18 — acotada a 5–20.
 * Con menos de 3 pagos no hay ritmo: 7 días.
 */
export function ventanaPeriodo(fechas: string[]): number {
  const unicas = [...new Set(fechas.map((f) => f.slice(0, 10)).filter(Boolean))].sort();
  if (unicas.length < 3) return 7;
  const gaps: number[] = [];
  for (let i = 1; i < unicas.length; i++) gaps.push(diasEntre(unicas[i - 1], unicas[i]));
  gaps.sort((a, b) => a - b);
  const mediana = gaps[Math.floor(gaps.length / 2)];
  return Math.min(20, Math.max(5, Math.round(mediana * 0.6)));
}

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const evidenciaDeMontos = (montos: number[]): string => {
  const min = Math.min(...montos);
  const max = Math.max(...montos);
  return max - min < 1 ? `siempre ${fmtCOP(min)}` : `${fmtCOP(min)}–${fmtCOP(max)}`;
};

/** ¿El monto cae dentro (con 2% de tolerancia) del rango histórico? */
const montoCalza = (montos: number[], monto: number): boolean => {
  if (!montos.length || monto <= 0) return false;
  const min = Math.min(...montos);
  const max = Math.max(...montos);
  return monto >= min * 0.98 && monto <= max * 1.02;
};

/**
 * Dado categoría + monto, ranquea los beneficiarios históricos de esa
 * categoría: primero los que NO cobraron ya en este período, después los que
 * calzan en monto, después por frecuencia.
 *
 * "Ya cobró en el período" (Nico 2026-11-11: dos empleadas de $1.000.000, la
 * fila de abajo seguía proponiendo a Yolanda cuando la de arriba ya era de
 * ella): el candidato tiene un pago de la MISMA categoría y el MISMO monto
 * (±2%) dentro de la ventana de su ritmo de pago (ventanaPeriodo) alrededor
 * de la fecha de esta fila, sin contar la fila misma. Vale para nómina,
 * arriendo, servicios: cualquier pago periódico de monto fijo.
 */
export function sugerirBeneficiario(
  h: HistorialConciliacion,
  categoryId: string | null | undefined,
  amount: number | null | undefined,
  max = 3,
  ctx?: ContextoSugerencia,
): SugerenciaBeneficiario[] {
  if (!categoryId) return [];
  const porResp = h.porCategoria.get(categoryId);
  if (!porResp) return [];
  const monto = Math.abs(Number(amount ?? 0));
  // Se compara contra el histórico del MISMO signo: lo que le pagás a un
  // tercero no dice nada de lo que te compra.
  const signo = signoDe(amount);

  // Pagos frescos de la pantalla: pisan al historial por id (la fila recién
  // asignada todavía no está en el cache del historial).
  const recientes = ctx?.recientes ?? [];
  const idsRecientes = new Set(recientes.map((t) => t.id).filter((id): id is string => !!id));
  const fecha = ctx?.date ? ctx.date.slice(0, 10) : null;
  const yaCobro = (responsibleId: string, stats: StatsCatResp | undefined): string | null => {
    if (!fecha || monto <= 0) return null;
    const pagos: PagoHistorial[] = [
      ...(stats?.pagos ?? []).filter((p) => !(p.id && idsRecientes.has(p.id))),
      ...recientes
        .filter((t) => t.category_id === categoryId && t.responsible_id === responsibleId && signoDe(t.amount) === signo)
        .map((t) => ({ id: t.id, date: (t.date ?? '').slice(0, 10), monto: Math.abs(Number(t.amount ?? 0)) })),
    ].filter((p) => p.date && !(ctx?.txId && p.id === ctx.txId));
    const ventana = ventanaPeriodo(pagos.map((p) => p.date));
    const iguales = pagos
      .filter((p) => Math.abs(p.monto - monto) <= monto * 0.02 && diasEntre(p.date, fecha) <= ventana)
      .sort((a, b) => b.date.localeCompare(a.date));
    return iguales[0]?.date ?? null;
  };

  const out: SugerenciaBeneficiario[] = [];
  for (const [responsibleId, veces] of porResp) {
    if (veces < 2) continue; // 1 sola vez no es patrón
    const stats = h.porCatResp.get(claveCatResp(categoryId, responsibleId, signo));
    const montos = stats?.montos ?? [];
    out.push({
      responsibleId,
      veces,
      calzaMonto: montoCalza(montos, monto),
      evidenciaMonto: montos.length ? evidenciaDeMontos(montos) : '',
      yaCobroEl: yaCobro(responsibleId, stats),
    });
  }
  return out
    .sort((a, b) =>
      Number(!!a.yaCobroEl) - Number(!!b.yaCobroEl)
      || Number(b.calzaMonto) - Number(a.calzaMonto)
      || b.veces - a.veces)
    .slice(0, max);
}

// ── 1b. Categoría sugerida por descripción ──────────────────────────────────

export interface SugerenciaCategoria {
  categoryId: string;
  veces: number;
  total: number;
}

/** La categoría dominante de esta descripción (≥3 casos y ≥60% de acuerdo). */
export function sugerirCategoria(
  h: HistorialConciliacion,
  description: string | null | undefined,
): SugerenciaCategoria | null {
  const d = h.porDesc.get(normalizeForMatch(description ?? ''));
  if (!d) return null;
  let top: SugerenciaCategoria | null = null;
  let clasificadas = 0;
  for (const [categoryId, veces] of d.categorias) {
    clasificadas += veces;
    if (!top || veces > top.veces) top = { categoryId, veces, total: 0 };
  }
  if (!top || clasificadas < 3) return null;
  top.total = clasificadas;
  return top.veces / clasificadas >= 0.6 ? top : null;
}

// ── 2. Alertas de clasificación inusual (avisan, nunca bloquean) ────────────

export interface AlertaCategoria {
  dominanteId: string;
  veces: number;
  total: number;
}

/**
 * La categoría elegida contradice el histórico de esa descripción
 * (≥4 casos previos y ≥75% de acuerdo en otra). Umbral alto a propósito:
 * si avisa demasiado, se ignora y no sirve.
 */
export function alertaCategoriaInusual(
  h: HistorialConciliacion,
  description: string | null | undefined,
  elegidaId: string | null,
): AlertaCategoria | null {
  if (!elegidaId) return null;
  const d = h.porDesc.get(normalizeForMatch(description ?? ''));
  if (!d) return null;
  let domId = '';
  let domVeces = 0;
  let clasificadas = 0;
  for (const [categoryId, veces] of d.categorias) {
    clasificadas += veces;
    if (veces > domVeces) { domId = categoryId; domVeces = veces; }
  }
  if (clasificadas < 4 || domVeces / clasificadas < 0.75) return null;
  return domId !== elegidaId ? { dominanteId: domId, veces: domVeces, total: clasificadas } : null;
}

export interface AlertaMonto {
  min: number;
  max: number;
  n: number;
  texto: string;
}

/**
 * El monto se sale del rango histórico de ese beneficiario en esa categoría
 * (≥4 movimientos previos DEL MISMO SIGNO, y el monto queda 30% fuera).
 *
 * El signo importa: a Ferromendez le pagás ~$950.000 y le vendés
 * $20.000.000 — la venta no es "rara" solo porque no se parezca a los
 * pagos (reporte de Nico 2026-08-08).
 */
export function alertaMontoInusual(
  h: HistorialConciliacion,
  categoryId: string | null,
  responsibleId: string | null,
  amount: number | null | undefined,
): AlertaMonto | null {
  if (!categoryId || !responsibleId) return null;
  const stats = h.porCatResp.get(claveCatResp(categoryId, responsibleId, signoDe(amount)));
  if (!stats || stats.n < 4) return null;
  const monto = Math.abs(Number(amount ?? 0));
  if (monto <= 0) return null;
  const min = Math.min(...stats.montos);
  const max = Math.max(...stats.montos);
  if (monto >= min * 0.7 && monto <= max * 1.3) return null;
  return { min, max, n: stats.n, texto: evidenciaDeMontos(stats.montos) };
}

// ── 3. Reglas sugeridas (cierran el ciclo) ──────────────────────────────────

export interface ReglaSugerida {
  /** Descripción para el humano: qué detectó y su evidencia. */
  titulo: string;
  evidencia: string;
  veces: number;
  regla: NewReconciliationRule;
}

const solape = (aMin: number | undefined, aMax: number | undefined, bMin: number, bMax: number): boolean => {
  const lo = aMin ?? 0;
  const hi = aMax ?? Number.MAX_SAFE_INTEGER;
  return lo <= bMax && bMin <= hi;
};

/**
 * Detecta patrones firmes y arma la regla lista para crear:
 *
 *   A. Descripción consistente: ≥4 casos y ≥90% siempre la misma combinación
 *      categoría+beneficiario → regla por keyword.
 *   B. Monto estable: categoría+beneficiario con ≥4 pagos en una banda de
 *      ±8% cuya descripción es ambigua (transferencias) → regla por
 *      keyword + rango de monto. Solo si NINGÚN pago histórico de otro
 *      beneficiario cae en esa banda con esa descripción (no ensuciar).
 *
 * Se excluye lo ya cubierto por reglas existentes.
 */
export function sugerirReglas(
  h: HistorialConciliacion,
  reglasExistentes: ReconciliationRule[],
  nombres: { categoria: (id: string) => string; responsable: (id: string) => string },
  max = 8,
): ReglaSugerida[] {
  const activas = reglasExistentes.filter((r) => r.active);
  const kwCubierto = (desc: string, montoMin?: number, montoMax?: number): boolean =>
    activas.some((r) => {
      if (!r.keyword || r.keyword_is_regex) return false;
      const kw = normalizeForMatch(r.keyword);
      if (!kw || !desc.includes(kw)) return false;
      // Sin banda en la regla = cubre todo el rango.
      if (r.amount_min == null && r.amount_max == null) return true;
      return montoMin != null && montoMax != null && solape(r.amount_min, r.amount_max, montoMin, montoMax);
    });

  const out: ReglaSugerida[] = [];
  const descsUsadas = new Set<string>();

  // A. Descripciones consistentes.
  for (const [desc, d] of h.porDesc) {
    if (d.total < 4) continue;
    let comboTop = '';
    let comboVeces = 0;
    for (const [combo, veces] of d.combos) {
      if (veces > comboVeces) { comboTop = combo; comboVeces = veces; }
    }
    if (!comboTop || comboVeces / d.total < 0.9) continue;
    if (kwCubierto(desc)) continue;
    const [categoryId, responsibleId] = comboTop.split('|');
    const tipo = inferirTipo(h, desc);
    descsUsadas.add(desc);
    out.push({
      titulo: `«${desc}» → ${nombres.categoria(categoryId)} · ${nombres.responsable(responsibleId)}`,
      evidencia: `${comboVeces} de ${d.total} veces con esa combinación`,
      veces: comboVeces,
      regla: {
        name: `${desc} → ${nombres.categoria(categoryId)}`,
        keyword: desc,
        tx_type: tipo,
        category_id: categoryId,
        category_name: nombres.categoria(categoryId),
        responsible_id: responsibleId,
        responsible_name: nombres.responsable(responsibleId),
        auto_conciliate: true,
      },
    });
  }

  // B. Montos estables con descripción ambigua.
  for (const [key, s] of h.porCatResp) {
    if (s.n < 4) continue;
    const min = Math.min(...s.montos);
    const max = Math.max(...s.montos);
    if (max > min * 1.08) continue; // banda estable = ±8%
    // Descripción más frecuente del grupo (el "canal": transferencia, etc.)
    let desc = '';
    let descVeces = 0;
    for (const [d, v] of s.descs) if (v > descVeces) { desc = d; descVeces = v; }
    if (!desc || descsUsadas.has(desc)) continue; // ya salió por la vía A
    const [categoryId, responsibleId] = key.split('|');
    const bandaMin = Math.floor(min * 0.97);
    const bandaMax = Math.ceil(max * 1.03);
    // Nadie más puede caer en la banda con esa descripción.
    const ajeno = h.txs.some((t) => {
      if (t.responsible_id === responsibleId) return false;
      const m = Math.abs(Number(t.amount ?? 0));
      return m >= bandaMin && m <= bandaMax && normalizeForMatch(t.description ?? '').includes(desc);
    });
    if (ajeno) continue;
    if (kwCubierto(desc, bandaMin, bandaMax)) continue;
    const tipo = inferirTipo(h, desc);
    out.push({
      titulo: `${nombres.categoria(categoryId)} de ${evidenciaDeMontos(s.montos)} → ${nombres.responsable(responsibleId)}`,
      evidencia: `${s.n} pagos, todos a ${nombres.responsable(responsibleId)} («${desc}»)`,
      veces: s.n,
      regla: {
        name: `${nombres.categoria(categoryId)} ${fmtCOP(min)} → ${nombres.responsable(responsibleId)}`,
        keyword: desc,
        amount_min: bandaMin,
        amount_max: bandaMax,
        tx_type: tipo,
        category_id: categoryId,
        category_name: nombres.categoria(categoryId),
        responsible_id: responsibleId,
        responsible_name: nombres.responsable(responsibleId),
        auto_conciliate: true,
      },
    });
  }

  return out.sort((a, b) => b.veces - a.veces).slice(0, max);
}

// ── 4. Auditoría: cómo se está conciliando cada descripción ─────────────────

export interface GrupoDescripcion {
  /** Descripción normalizada (llave del grupo). */
  desc: string;
  /** La escritura original más frecuente, para mostrar. */
  muestra: string;
  txs: TxHistorial[];
  categorias: Map<string, number>;
  responsables: Map<string, number>;
  /** Cuántas tienen categoría asignada (base de los porcentajes). */
  clasificadas: number;
  montoMin: number;
  montoMax: number;
}

/** Agrupa el historial por descripción normalizada, ordenado por volumen. */
export function agruparPorDescripcion(h: HistorialConciliacion): GrupoDescripcion[] {
  const grupos = new Map<string, GrupoDescripcion>();
  const escrituras = new Map<string, Map<string, number>>();
  for (const t of h.txs) {
    const desc = normalizeForMatch(t.description ?? '');
    if (!desc) continue;
    const g = grupos.get(desc) ?? {
      desc, muestra: t.description ?? desc, txs: [], categorias: new Map(),
      responsables: new Map(), clasificadas: 0, montoMin: Infinity, montoMax: 0,
    };
    g.txs.push(t);
    if (t.category_id) { inc(g.categorias, t.category_id); g.clasificadas++; }
    if (t.responsible_id) inc(g.responsables, t.responsible_id);
    const m = Math.abs(Number(t.amount ?? 0));
    if (m > 0) { g.montoMin = Math.min(g.montoMin, m); g.montoMax = Math.max(g.montoMax, m); }
    grupos.set(desc, g);
    const esc = escrituras.get(desc) ?? new Map<string, number>();
    inc(esc, t.description ?? desc);
    escrituras.set(desc, esc);
  }
  for (const [desc, g] of grupos) {
    let top = ''; let topN = 0;
    for (const [e, n] of escrituras.get(desc) ?? []) if (n > topN) { top = e; topN = n; }
    if (top) g.muestra = top;
    if (g.montoMin === Infinity) g.montoMin = 0;
  }
  return [...grupos.values()].sort((a, b) => b.txs.length - a.txs.length);
}

export interface AlertaAuditoria {
  grupo: GrupoDescripcion;
  campo: 'categoria' | 'beneficiario';
  dominanteId: string;
  dominanteVeces: number;
  total: number;
  /** Las que se salen de la dominante — los errores probables. */
  outliers: TxHistorial[];
}

/**
 * Inconsistencias con mayoría clara: ≥4 clasificadas, una dominante con ≥75%
 * y al menos una que se sale. Las descripciones genuinamente mixtas (las
 * transferencias genéricas, sin dominante) NO alertan — van en el listado
 * general, que para eso está.
 */
export function detectarAlertasAuditoria(grupos: GrupoDescripcion[]): AlertaAuditoria[] {
  const out: AlertaAuditoria[] = [];
  for (const g of grupos) {
    for (const campo of ['categoria', 'beneficiario'] as const) {
      const conteos = campo === 'categoria' ? g.categorias : g.responsables;
      const valorDe = (t: TxHistorial) => (campo === 'categoria' ? t.category_id : t.responsible_id);
      let domId = ''; let domVeces = 0; let total = 0;
      for (const [id, n] of conteos) { total += n; if (n > domVeces) { domId = id; domVeces = n; } }
      if (total < 4 || domVeces === total || domVeces / total < 0.75) continue;
      out.push({
        grupo: g, campo, dominanteId: domId, dominanteVeces: domVeces, total,
        outliers: g.txs.filter((t) => valorDe(t) && valorDe(t) !== domId),
      });
    }
  }
  return out.sort((a, b) => b.outliers.length - a.outliers.length || b.total - a.total);
}

/** Tipo de la regla según el signo histórico de esa descripción. */
function inferirTipo(h: HistorialConciliacion, desc: string): 'ingreso' | 'egreso' {
  let ingresos = 0;
  let egresos = 0;
  for (const t of h.txs) {
    if (normalizeForMatch(t.description ?? '') !== desc) continue;
    if (Number(t.amount ?? 0) > 0) ingresos++;
    else egresos++;
  }
  return ingresos > egresos ? 'ingreso' : 'egreso';
}
