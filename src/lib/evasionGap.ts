/**
 * evasionGap — Fuente única de verdad para medir la "brecha" entre los
 * ingresos reales del negocio y lo que aparece facturado ante la DIAN.
 *
 * Modelo mental (Colombia, SMB real):
 *   Ingresos reales = Ingresos por extracto + Ingresos en efectivo
 *   Ingresos extracto = Facturados + Conciliados sin factura (pendientes)
 *   Sin facturar      = Pendientes (extracto sin factura) + Efectivos
 *   % sin facturar    = Sin facturar / Ingresos reales
 *
 * Por qué "pendiente" cuenta como evasión:
 * entró plata al banco pero no hay factura emitida ante la DIAN, así que
 * tributariamente es invisible igual que el efectivo. Puede ser algo por
 * conciliar o simplemente no facturado.
 *
 * Usada en: Dashboard (card), PyG (fila), Visita DIAN (simulador),
 * y contexto del agente Nico Gerencial.
 */

export type EvasionLevel = 'low' | 'mid' | 'high';

export interface EvasionGapInput {
  /** Ingresos totales por extracto bancario (transactions con amount > 0) */
  bankIncome: number;
  /**
   * Subconjunto de bankIncome que está conciliado con una factura emitida.
   * En BD: transactions.invoice_id != null con amount > 0.
   * Este es el único monto visible para la DIAN.
   */
  invoicedIncome: number;
  /** Ingresos registrados como cash_movements tipo='ingreso' (efectivo) */
  cashIncome: number;
}

export interface EvasionGapResult {
  /** Ingresos totales reales del negocio = extracto + efectivo */
  real: number;
  /** Ingresos visibles para la DIAN = solo facturados */
  dian: number;
  /** Plata por extracto que NO tiene factura (conciliados sin factura) */
  pendingBank: number;
  /** Plata en efectivo (nunca pasó por banco) */
  cash: number;
  /** Monto total no facturado = pendingBank + cash */
  gap: number;
  /** % del total real que no está facturado (0..1). 0 si real = 0. */
  gapPct: number;
  /** Nivel de alerta para pintar banners y CTAs. */
  level: EvasionLevel;
}

/**
 * Umbrales de nivel de evasión (editables si el producto cambia de criterio).
 * - low:  [0, 15%)  → verde, celebración
 * - mid:  [15%, 35%) → amarillo, tenemos que hablar
 * - high: [35%, ∞)   → rojo, alto riesgo DIAN
 */
export const EVASION_THRESHOLDS = {
  mid: 0.15,
  high: 0.35,
} as const;

/**
 * Calcula la brecha entre ingresos reales e ingresos visibles para la DIAN.
 *
 * Diseño: función pura. No consulta Supabase, no depende de React.
 * Recibe las cifras ya sumadas y devuelve el análisis.
 */
export function calculateEvasionGap(input: EvasionGapInput): EvasionGapResult {
  // Negativos y NaN colapsan a 0 para evitar % absurdos.
  const bank = toSafeNumber(input.bankIncome);
  const invoiced = toSafeNumber(input.invoicedIncome);
  const cash = toSafeNumber(input.cashIncome);

  // Defensa: invoicedIncome no puede superar bankIncome (caso raro de datos sucios).
  const invoicedSafe = Math.min(invoiced, bank);

  const real = bank + cash;
  const dian = invoicedSafe;
  const pendingBank = Math.max(0, bank - invoicedSafe);
  const gap = pendingBank + cash;
  const gapPct = real > 0 ? gap / real : 0;

  return {
    real,
    dian,
    pendingBank,
    cash,
    gap,
    gapPct,
    level: levelFromPct(gapPct),
  };
}

export function levelFromPct(pct: number): EvasionLevel {
  if (pct >= EVASION_THRESHOLDS.high) return 'high';
  if (pct >= EVASION_THRESHOLDS.mid) return 'mid';
  return 'low';
}

function toSafeNumber(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

/**
 * Etiquetas de UI sugeridas por nivel. Mantiene el copy en una sola fuente
 * para que Dashboard, PyG y Visita DIAN hablen igual.
 */
export const LEVEL_COPY: Record<EvasionLevel, { title: string; subtitle: string; tone: 'green' | 'amber' | 'red' }> = {
  low: {
    title: 'Nivel de formalización alto',
    subtitle: 'Buen trabajo: la mayor parte de tus ingresos está facturada.',
    tone: 'green',
  },
  mid: {
    title: 'Tenés ingresos sin facturar',
    subtitle: 'Revisá tu rentabilidad real: la DIAN podría auditar.',
    tone: 'amber',
  },
  high: {
    title: 'Alto riesgo DIAN',
    subtitle: 'Tu exposición es significativa. Mirá el análisis de rentabilidad.',
    tone: 'red',
  },
};
