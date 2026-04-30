/**
 * Cálculo de tablas de amortización para créditos.
 *
 * - Francesa: cuota fija (capital + interés constantes en total).
 * - Alemana: capital constante (cuota decreciente, interés sobre saldo).
 * - Bullet: solo paga intereses durante el plazo, capital al final.
 *
 * Permite recalcular tabla restante después de abonos extraordinarios.
 */

export type AmortizationType = 'francesa' | 'alemana' | 'bullet';

export interface AmortizationRow {
  cuotaNumero: number;
  fecha: string; // YYYY-MM-DD
  cuotaTotal: number;
  capitalPagado: number;
  interesPagado: number;
  saldoRestante: number;
}

export interface AmortizationInput {
  principal: number;
  interestRateMonthlyPct: number; // ej 1.5 = 1.5%
  termMonths: number;
  firstPaymentDate: string; // YYYY-MM-DD
  type: AmortizationType;
}

/**
 * Suma N meses a una fecha YYYY-MM-DD. Maneja overflow de día (ej. 31 enero
 * + 1 mes = 28 feb).
 */
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const targetMonth = date.getMonth() + months;
  const target = new Date(date.getFullYear(), targetMonth, 1);
  // último día del mes destino
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const dayUsed = Math.min(d, lastDay);
  const result = new Date(target.getFullYear(), target.getMonth(), dayUsed);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cuota fija mensual (sistema francés): A = P · i / (1 - (1+i)^-n) */
export function frenchPayment(principal: number, monthlyRate: number, n: number): number {
  if (monthlyRate === 0) return principal / n;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
}

export function buildAmortization(input: AmortizationInput): AmortizationRow[] {
  const { principal, interestRateMonthlyPct, termMonths, firstPaymentDate, type } = input;
  const i = interestRateMonthlyPct / 100;
  const rows: AmortizationRow[] = [];
  let saldo = principal;

  if (type === 'francesa') {
    const cuota = frenchPayment(principal, i, termMonths);
    for (let k = 1; k <= termMonths; k++) {
      const interes = saldo * i;
      let capital = cuota - interes;
      if (k === termMonths) capital = saldo; // ajuste para que cierre en 0
      const cuotaReal = capital + interes;
      saldo = saldo - capital;
      rows.push({
        cuotaNumero: k,
        fecha: addMonths(firstPaymentDate, k - 1),
        cuotaTotal: r2(cuotaReal),
        capitalPagado: r2(capital),
        interesPagado: r2(interes),
        saldoRestante: r2(Math.max(0, saldo)),
      });
    }
  } else if (type === 'alemana') {
    const capital = principal / termMonths;
    for (let k = 1; k <= termMonths; k++) {
      const interes = saldo * i;
      const capitalReal = k === termMonths ? saldo : capital;
      const cuotaReal = capitalReal + interes;
      saldo = saldo - capitalReal;
      rows.push({
        cuotaNumero: k,
        fecha: addMonths(firstPaymentDate, k - 1),
        cuotaTotal: r2(cuotaReal),
        capitalPagado: r2(capitalReal),
        interesPagado: r2(interes),
        saldoRestante: r2(Math.max(0, saldo)),
      });
    }
  } else {
    // bullet: paga solo intereses cada mes, capital al final
    for (let k = 1; k <= termMonths; k++) {
      const interes = saldo * i;
      const capital = k === termMonths ? saldo : 0;
      const cuotaReal = capital + interes;
      saldo = saldo - capital;
      rows.push({
        cuotaNumero: k,
        fecha: addMonths(firstPaymentDate, k - 1),
        cuotaTotal: r2(cuotaReal),
        capitalPagado: r2(capital),
        interesPagado: r2(interes),
        saldoRestante: r2(Math.max(0, saldo)),
      });
    }
  }

  return rows;
}

export interface AmortizationSummary {
  /** Programa teórico desde la creación, sin descontar pagos hechos. */
  schedule: AmortizationRow[];
  /** Capital pagado realmente. */
  totalPrincipalPaid: number;
  /** Intereses pagados realmente. */
  totalInterestPaid: number;
  /** Total pagado realmente (capital + interés). */
  totalPaid: number;
  /** Saldo de capital pendiente actualmente. */
  currentBalance: number;
  /** % del crédito pagado (sobre principal). */
  percentPaid: number;
  /** Próxima cuota teórica pendiente (la que viene). */
  nextCuota: AmortizationRow | null;
  /** Total intereses TEÓRICOS del schedule (suma de la columna interes). */
  totalInterestScheduled: number;
  /** Costo único de costos adicionales (Fogafin, comisión, etc.) sobre el principal. */
  additionalCostsAmount: number;
  /** Costo total del crédito = principal × (1 + additionalCostsPct/100) + intereses teóricos. */
  totalCreditCost: number;
}

export function summarizeCredit(
  input: AmortizationInput,
  payments: Array<{ payment_date: string; amount_paid: number; principal_paid: number; interest_paid: number; is_extra: boolean }>,
  additionalCostsPct: number = 0,
): AmortizationSummary {
  const schedule = buildAmortization(input);
  const totalPrincipalPaid = payments.reduce((s, p) => s + Number(p.principal_paid || 0), 0);
  const totalInterestPaid = payments.reduce((s, p) => s + Number(p.interest_paid || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  const currentBalance = Math.max(0, input.principal - totalPrincipalPaid);
  const percentPaid = input.principal > 0 ? (totalPrincipalPaid / input.principal) * 100 : 0;

  // Próxima cuota: la primera cuya fecha es ≥ hoy
  const today = new Date().toISOString().slice(0, 10);
  const nextCuota = schedule.find(r => r.fecha >= today) ?? null;

  const totalInterestScheduled = schedule.reduce((s, r) => s + r.interesPagado, 0);
  const additionalCostsAmount = input.principal * (additionalCostsPct / 100);
  const totalCreditCost = input.principal + totalInterestScheduled + additionalCostsAmount;

  return {
    schedule,
    totalPrincipalPaid: r2(totalPrincipalPaid),
    totalInterestPaid: r2(totalInterestPaid),
    totalPaid: r2(totalPaid),
    currentBalance: r2(currentBalance),
    percentPaid: r2(percentPaid),
    nextCuota,
    totalInterestScheduled: r2(totalInterestScheduled),
    additionalCostsAmount: r2(additionalCostsAmount),
    totalCreditCost: r2(totalCreditCost),
  };
}

/**
 * Simula qué pasaría si hacés un abono extraordinario hoy.
 * Devuelve cuánto te ahorrarías en intereses futuros si el saldo se reduce
 * inmediatamente y seguís pagando las cuotas restantes (modalidad: reducir
 * el plazo, terminás antes pagando lo mismo).
 */
export function simulateExtraPayment(
  currentBalance: number,
  monthlyRatePct: number,
  remainingMonths: number,
  extraAmount: number,
  amortizationType: AmortizationType,
): {
  newBalance: number;
  interestSavedReducingTerm: number;
  interestSavedKeepingTerm: number;
  monthsSavedReducingTerm: number;
} {
  const i = monthlyRatePct / 100;
  const newBalance = Math.max(0, currentBalance - extraAmount);

  // Sin abono: intereses futuros del saldo actual
  const baseFuture = simulateInterestForward(currentBalance, monthlyRatePct, remainingMonths, amortizationType);
  // Con abono, manteniendo plazo (cuota baja)
  const keepTermFuture = simulateInterestForward(newBalance, monthlyRatePct, remainingMonths, amortizationType);
  const interestSavedKeepingTerm = baseFuture - keepTermFuture;

  // Con abono, reduciendo plazo: mantener cuota original y ver cuántos meses tarda
  let monthsSavedReducingTerm = 0;
  let interestSavedReducingTerm = 0;
  if (amortizationType === 'francesa' && newBalance > 0 && i > 0) {
    const cuotaOriginal = frenchPayment(currentBalance, i, remainingMonths);
    // n = -log(1 - newBalance·i/cuota) / log(1+i)
    const ratio = (newBalance * i) / cuotaOriginal;
    if (ratio < 1) {
      const newN = Math.ceil(-Math.log(1 - ratio) / Math.log(1 + i));
      monthsSavedReducingTerm = remainingMonths - newN;
      const totalCuotasOriginal = cuotaOriginal * remainingMonths;
      const totalCuotasNuevo = cuotaOriginal * newN;
      // intereses ahorrados ≈ (cuotas pagadas en menos meses) - capital extra abonado
      interestSavedReducingTerm = (totalCuotasOriginal - totalCuotasNuevo);
    }
  } else {
    interestSavedReducingTerm = interestSavedKeepingTerm;
  }

  return {
    newBalance: r2(newBalance),
    interestSavedReducingTerm: r2(Math.max(0, interestSavedReducingTerm)),
    interestSavedKeepingTerm: r2(Math.max(0, interestSavedKeepingTerm)),
    monthsSavedReducingTerm: Math.max(0, monthsSavedReducingTerm),
  };
}

function simulateInterestForward(balance: number, monthlyRatePct: number, months: number, type: AmortizationType): number {
  if (balance <= 0 || months <= 0) return 0;
  const i = monthlyRatePct / 100;
  let saldo = balance;
  let totalInt = 0;
  if (type === 'francesa') {
    const cuota = frenchPayment(balance, i, months);
    for (let k = 1; k <= months; k++) {
      const interes = saldo * i;
      const capital = Math.min(cuota - interes, saldo);
      totalInt += interes;
      saldo -= capital;
      if (saldo <= 0.01) break;
    }
  } else if (type === 'alemana') {
    const capital = balance / months;
    for (let k = 1; k <= months; k++) {
      const interes = saldo * i;
      const capitalReal = Math.min(capital, saldo);
      totalInt += interes;
      saldo -= capitalReal;
      if (saldo <= 0.01) break;
    }
  } else {
    totalInt = balance * i * months;
  }
  return totalInt;
}

/**
 * Sugiere la división capital/interés para un pago dado, basada en el saldo
 * actual y la tasa. Útil cuando el usuario registra un pago: el sistema
 * propone la separación pero el usuario puede ajustarla.
 */
export function suggestPaymentSplit(
  currentBalance: number,
  monthlyRatePct: number,
  amountPaid: number,
  isExtra: boolean,
): { principal: number; interest: number } {
  const interest = isExtra ? 0 : currentBalance * (monthlyRatePct / 100);
  const principal = Math.max(0, amountPaid - interest);
  // No dejar que el capital exceda el saldo
  const principalCapped = Math.min(principal, currentBalance);
  const interestActual = amountPaid - principalCapped;
  return {
    principal: r2(principalCapped),
    interest: r2(interestActual),
  };
}
