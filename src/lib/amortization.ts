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
}

export function summarizeCredit(
  input: AmortizationInput,
  payments: Array<{ payment_date: string; amount_paid: number; principal_paid: number; interest_paid: number; is_extra: boolean }>,
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

  return {
    schedule,
    totalPrincipalPaid: r2(totalPrincipalPaid),
    totalInterestPaid: r2(totalInterestPaid),
    totalPaid: r2(totalPaid),
    currentBalance: r2(currentBalance),
    percentPaid: r2(percentPaid),
    nextCuota,
  };
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
