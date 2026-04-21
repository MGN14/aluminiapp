/**
 * evasionGap — Fuente única de verdad para medir la "brecha" entre los
 * ingresos reales del negocio y lo que aparece facturado ante la DIAN.
 *
 * Modelo mental (Colombia, SMB real):
 *   Real         = Extracto + Anticipos periodo anterior + Efectivo
 *   DIAN         = Facturas emitidas en el periodo (tabla invoices, type='venta')
 *                  → Es lo tributariamente visible, esté cobrado o no.
 *   Sin facturar = max(0, Real − DIAN)
 *   % sin facturar = Sin facturar / Real
 *
 * Tres flujos que suman Real, sin doble conteo:
 *   1. Extracto (bankIncome): todo lo que entró al banco este periodo.
 *      Fuente: SUM(transactions.amount > 0) del periodo.
 *   2. Anticipos periodo anterior (previousPeriodAdvances): plata que se
 *      recibió en años previos pero NO se facturó. No está en el extracto
 *      actual. Fuente: initial_financial_state.anticipos_de_clientes, solo
 *      los detalles que aún no se conciliaron contra una factura.
 *   3. Efectivo (cashIncome): plata que nunca pasó por banco.
 *      Fuente: SUM(cash_movements WHERE type='ingreso') del periodo.
 *
 * Por qué Real puede diferir de DIAN:
 *   - Plata cobrada sin factura emitida (anticipos viejos, efectivo, pagos
 *     pendientes) → no aparece ante la DIAN.
 *   - Facturas emitidas no cobradas → aparecen en DIAN pero no en Real.
 *     En ese caso gap = 0: no hay evasión, hay cuentas por cobrar.
 *
 * Usada en: Dashboard (card), PyG (fila), Visita DIAN (simulador),
 * y contexto del agente Nico Gerencial.
 */

export type EvasionLevel = 'low' | 'mid' | 'high';

export interface EvasionGapInput {
  /** Total de ingresos por extracto bancario en el periodo */
  bankIncome: number;
  /**
   * Anticipos de clientes arrastrados de periodos anteriores, no conciliados.
   * Plata que ya se recibió pero nunca se facturó. NO está en bankIncome.
   */
  previousPeriodAdvances: number;
  /** Ingresos en efectivo (cash_movements type='ingreso') */
  cashIncome: number;
  /**
   * Total facturado ante la DIAN en el periodo.
   * Fuente: SUM(invoices.total_amount) WHERE type='venta' AND issue_date ∈ periodo.
   */
  invoicedAmount: number;
}

export interface EvasionGapResult {
  /** Ingresos totales reales = bankIncome + previousPeriodAdvances + cashIncome */
  real: number;
  /** Ingresos facturados a la DIAN (clampado a real si hay datos sucios) */
  dian: number;
  /** Passthrough para desglose visual */
  bankIncome: number;
  previousPeriodAdvances: number;
  cash: number;
  /** Monto no facturado = max(0, real − dian) */
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
 * Calcula la brecha entre ingresos reales e ingresos facturados a la DIAN.
 *
 * Diseño: función pura. No consulta Supabase, no depende de React.
 * Recibe las cifras ya sumadas y devuelve el análisis.
 */
export function calculateEvasionGap(input: EvasionGapInput): EvasionGapResult {
  // Negativos y NaN colapsan a 0 para evitar % absurdos.
  const bank = toSafeNumber(input.bankIncome);
  const prevAdv = toSafeNumber(input.previousPeriodAdvances);
  const cash = toSafeNumber(input.cashIncome);
  const invoiced = toSafeNumber(input.invoicedAmount);

  const real = bank + prevAdv + cash;
  // Defensa: si DIAN > Real (facturas emitidas sin cobrar), el gap es 0.
  // No hay evasión; hay cuentas por cobrar (otro problema distinto).
  const dian = Math.min(invoiced, real);
  const gap = Math.max(0, real - dian);
  const gapPct = real > 0 ? gap / real : 0;

  return {
    real,
    dian,
    bankIncome: bank,
    previousPeriodAdvances: prevAdv,
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
