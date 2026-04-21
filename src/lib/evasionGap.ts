/**
 * evasionGap — Fuente única de verdad para medir la "brecha" entre los
 * ingresos reales del negocio (banco + efectivo no facturado) y lo que
 * aparecería ante la DIAN (solo lo que pasó por banco/factura).
 *
 * Usada en: Dashboard (card), PyG (fila), Visita DIAN (simulador),
 * y contexto del agente Nico Gerencial.
 *
 * El objetivo del producto es visibilizar el tamaño de esta brecha para
 * que el usuario pueda razonar con datos sobre su nivel de formalización.
 */

export type EvasionLevel = 'low' | 'mid' | 'high';

export interface EvasionGapInput {
  /** Ingresos vía extracto bancario (transactions positivas con ingreso real) */
  bankIncome: number;
  /** Ingresos registrados como cash_movements tipo='ingreso' (efectivo) */
  cashIncome: number;
}

export interface EvasionGapResult {
  /** Ingresos totales reales del negocio = banco + efectivo */
  real: number;
  /** Ingresos visibles para la DIAN = solo banco */
  dian: number;
  /** Monto no facturado = real − dian */
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
 * Recibe las dos cifras ya sumadas y devuelve el análisis.
 */
export function calculateEvasionGap(input: EvasionGapInput): EvasionGapResult {
  // Negativos y NaN colapsan a 0 para evitar % absurdos.
  const bank = toSafeNumber(input.bankIncome);
  const cash = toSafeNumber(input.cashIncome);

  const real = bank + cash;
  const dian = bank;
  const gap = Math.max(0, real - dian); // equivale a cash, pero robusto si llegan datos raros
  const gapPct = real > 0 ? gap / real : 0;

  return {
    real,
    dian,
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
