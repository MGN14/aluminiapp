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

export type CuotaEstado = 'pagada' | 'parcial' | 'pendiente' | 'saldado';

export interface AmortizationRowWithStatus extends AmortizationRow {
  estado: CuotaEstado;
  /** Saldo REAL después de aplicar pagos hasta esta cuota inclusive. */
  saldoRealRestante: number;
  /** Total pagado a esta cuota (de los registros reales). */
  pagadoEnCuota: number;
  /** Capital recalculado para cuotas futuras post-abono extra. */
  capitalEfectivo: number;
  /** Interés recalculado sobre saldo real para cuotas futuras. */
  interesEfectivo: number;
  /** True cuando hubo recálculo (saldo real < saldo teórico). */
  recalculada: boolean;
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
  /** Schedule con estado y saldo real considerando pagos efectivos. */
  scheduleWithStatus: AmortizationRowWithStatus[];
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

  const totalInterestScheduled = schedule.reduce((s, r) => s + r.interesPagado, 0);
  const additionalCostsAmount = input.principal * (additionalCostsPct / 100);
  const totalCreditCost = input.principal + totalInterestScheduled + additionalCostsAmount;

  // Schedule con estado por cuota considerando pagos efectivos.
  //
  // ASIGNACIÓN (fix 2026-08-19): los pagos NORMALES se imputan por FIFO a la
  // cuota impaga más VIEJA, sin importar la fecha exacta del débito. Antes se
  // asignaban por bucket de fecha (`payment_date <= row.fecha`) y un pago
  // debitado el 18 por festivo caía en la cuota del mes SIGUIENTE, dejando la
  // del 15 como "pendiente" (caso real de Nico, cuota del 15-ago cobrada el
  // 18-ago). Un pago que cubre dos cuotas llena ambas.
  //
  // Los abonos EXTRA no llenan cuotas: bajan el saldo real en su fecha y el
  // plazo se recorta (modalidad "reducir plazo": cuota teórica constante, las
  // cuotas finales quedan "saldado").
  const sortedPayments = payments.slice().sort((a, b) => a.payment_date.localeCompare(b.payment_date));
  const normalQueue = sortedPayments
    .filter((p) => !p.is_extra)
    .map((p) => ({
      total: Number(p.amount_paid || 0),
      capital: Number(p.principal_paid || 0),
      interes: Number(p.interest_paid || 0),
    }));
  const extras = sortedPayments.filter((p) => p.is_extra);

  const scheduleWithStatus: AmortizationRowWithStatus[] = [];
  let saldoReal = input.principal;
  const i = input.interestRateMonthlyPct / 100;
  let qIdx = 0;
  let eIdx = 0;
  let saldado = false;
  for (const row of schedule) {
    if (saldado) {
      // Crédito ya fue saldado en una cuota anterior — el resto no se paga
      scheduleWithStatus.push({
        ...row,
        cuotaTotal: 0,
        capitalPagado: 0,
        interesPagado: 0,
        saldoRestante: 0,
        estado: 'saldado',
        saldoRealRestante: 0,
        pagadoEnCuota: 0,
        capitalEfectivo: 0,
        interesEfectivo: 0,
        recalculada: true,
      });
      continue;
    }

    // 1. Abonos extra con fecha hasta esta cuota → bajan el saldo directo
    let extraCapital = 0;
    let extraInteres = 0;
    let extraTotal = 0;
    while (eIdx < extras.length && extras[eIdx].payment_date <= row.fecha) {
      extraCapital += Number(extras[eIdx].principal_paid || 0);
      extraInteres += Number(extras[eIdx].interest_paid || 0);
      extraTotal += Number(extras[eIdx].amount_paid || 0);
      eIdx++;
    }
    saldoReal = Math.max(0, saldoReal - extraCapital);

    // 2. FIFO: consumir pagos normales hasta cubrir la cuota teórica. Si un
    //    pago sobra, el resto queda en la cola para la cuota siguiente
    //    (capital/interés se reparten proporcionalmente).
    const cuotaEsperada = row.cuotaTotal;
    let consTotal = 0;
    let consCapital = 0;
    let consInteres = 0;
    while (qIdx < normalQueue.length && consTotal < cuotaEsperada - 0.5) {
      const p = normalQueue[qIdx];
      const falta = cuotaEsperada - consTotal;
      if (p.total <= falta + 0.5) {
        consTotal += p.total;
        consCapital += p.capital;
        consInteres += p.interes;
        qIdx++;
      } else {
        const frac = falta / p.total;
        consTotal += falta;
        consCapital += p.capital * frac;
        consInteres += p.interes * frac;
        p.capital *= 1 - frac;
        p.interes *= 1 - frac;
        p.total -= falta;
      }
    }
    saldoReal = Math.max(0, saldoReal - consCapital);

    const pagadoTotalEnCuota = consTotal + extraTotal;
    const tocada = pagadoTotalEnCuota > 0;

    // Para cuotas futuras (sin pagos): recalcular interés sobre saldo real
    // y derivar capital = cuota teórica - interés efectivo.
    const interesEfectivo = tocada ? consInteres + extraInteres : saldoReal * i;
    let capitalEfectivo = tocada ? consCapital + extraCapital : Math.max(0, cuotaEsperada - interesEfectivo);
    if (capitalEfectivo > saldoReal + consCapital + extraCapital) capitalEfectivo = saldoReal;
    const recalculada = !tocada && saldoReal > 0 && (saldoReal < row.saldoRestante + capitalEfectivo - 0.5);

    // Estado: solo los pagos normales consumidos "pagan" la cuota — un abono
    // extra no la marca pagada (va a capital, no a la obligación del mes).
    let estado: CuotaEstado;
    if (consTotal >= cuotaEsperada - 0.5) {
      estado = 'pagada';
    } else if (tocada) {
      estado = 'parcial';
    } else {
      estado = 'pendiente';
    }

    // Proyección para pendientes: el capital teórico baja el saldo estimado.
    const saldoPost = saldoReal - (!tocada ? capitalEfectivo : 0);
    if (saldoPost <= 0.5) {
      saldado = true; // las siguientes cuotas se marcarán como saldado
    }

    scheduleWithStatus.push({
      ...row,
      estado,
      saldoRealRestante: r2(Math.max(0, saldoPost)),
      pagadoEnCuota: r2(pagadoTotalEnCuota),
      capitalEfectivo: r2(capitalEfectivo),
      interesEfectivo: r2(interesEfectivo),
      recalculada,
    });

    saldoReal = Math.max(0, saldoPost);
  }

  // Próxima cuota REAL: la primera no cubierta (pendiente o parcial). Antes
  // era "primera con fecha ≥ hoy", que ignoraba si ya estaba pagada — y una
  // cuota vieja impaga nunca aparecía como próxima.
  const nextCuota: AmortizationRow | null =
    scheduleWithStatus.find((r) => r.estado === 'pendiente' || r.estado === 'parcial') ?? null;

  return {
    schedule,
    scheduleWithStatus,
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
  } else if (amortizationType === 'alemana' && newBalance > 0 && remainingMonths > 0) {
    // En alemana el capital mensual es FIJO: un abono extra se traduce
    // directo en cuotas que ya no se pagan. Antes esta rama caía en el else
    // y devolvía 0 meses ahorrados — justo el dato que más importa cuando
    // uno planea abonos (reporte de Nico 2026-08-08).
    const capitalMensual = currentBalance / remainingMonths;
    if (capitalMensual > 0) {
      monthsSavedReducingTerm = Math.min(remainingMonths, Math.floor(extraAmount / capitalMensual));
      const newN = Math.max(1, remainingMonths - monthsSavedReducingTerm);
      interestSavedReducingTerm = baseFuture
        - simulateInterestForward(newBalance, monthlyRatePct, newN, 'alemana');
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
