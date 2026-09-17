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

/**
 * Fila del cronograma con el estado real. OJO: acá `cuotaTotal`,
 * `capitalPagado` e `interesPagado` ya NO son los del plan original sino la
 * cuota ESPERADA dado el saldo real (lo que el banco va a cobrar). El plan
 * original sigue intacto en `AmortizationSummary.schedule`.
 */
export interface AmortizationRowWithStatus extends AmortizationRow {
  estado: CuotaEstado;
  /** Saldo REAL después de aplicar pagos hasta esta cuota inclusive. */
  saldoRealRestante: number;
  /** Total pagado en la ventana de esta cuota (cuota + abonos extra). */
  pagadoEnCuota: number;
  /** Lo pagado de la CUOTA en sí (pagos normales, sin abonos extra). */
  pagadoNormal: number;
  /** Capital: el esperado si la cuota está pendiente; el realmente pagado si ya se tocó. */
  capitalEfectivo: number;
  /** Interés: el esperado si la cuota está pendiente; el realmente pagado si ya se tocó. */
  interesEfectivo: number;
  /** Abono extraordinario a capital hecho en la ventana de esta cuota
   *  (desde su fecha hasta antes de la siguiente). Columna propia en la UI. */
  abonoExtraCapital: number;
  /** True cuando la cuota esperada difiere del plan original (saldo real < teórico por abonos). */
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
  /** Total intereses del PLAN ORIGINAL (suma de la columna interés del schedule). */
  totalInterestScheduled: number;
  /** Intereses PROYECTADOS con lo que pasó de verdad: los ya pagados + los
   *  esperados de las cuotas pendientes sobre el saldo real. Baja con cada
   *  abono extra (el plan original no). */
  totalInterestProjected: number;
  /** Cuánto se ahorra vs. el plan original (abonos extra). 0 si no hay ahorro. */
  interestSavedVsPlan: number;
  /** Costo único de costos adicionales (Fogafin, comisión, etc.) sobre el principal. */
  additionalCostsAmount: number;
  /** Costo total del crédito = principal + intereses PROYECTADOS + costos adicionales. */
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

  // Schedule con estado por cuota considerando pagos efectivos.
  //
  // CUOTA ESPERADA (fix 2026-09-16): lo que el banco va a cobrar en cada
  // cuota dado el saldo REAL, según el tipo de crédito:
  //   - alemana: capital FIJO (principal/plazo) + interés sobre saldo real.
  //     Un abono extra NO cambia el capital de las cuotas siguientes: baja el
  //     interés y el crédito termina antes (las últimas quedan saldadas).
  //     Antes se mantenía la CUOTA teórica original y solo se re-partía
  //     capital/interés — eso es lógica de cuota fija, y daba $5.479.583
  //     donde Bancolombia cobraba $5.384.239 (crédito real de Nico).
  //   - francesa: cuota fija; interés sobre saldo real y capital = el resto
  //     (modalidad reducir plazo).
  //   - bullet: solo interés sobre saldo real; el capital va en la última.
  //
  // El interés de una cuota se liquida con el saldo al INICIO de su ventana:
  // un abono hecho después del corte recién rebaja la cuota SIGUIENTE (así
  // lo hace el banco). Y una cuota pendiente muestra siempre lo esperado,
  // aunque en su ventana haya un abono extra (antes mostraba el abono como
  // si fuera la cuota: capital $10M, interés $0).
  //
  // ASIGNACIÓN (fix 2026-08-19): los pagos NORMALES se imputan por FIFO a la
  // cuota impaga más VIEJA, sin importar la fecha exacta del débito (un pago
  // debitado el 18 por festivo es la cuota del 15). Un pago que cubre dos
  // cuotas llena ambas. Los abonos EXTRA no llenan cuotas: bajan el saldo
  // real en su fecha.
  //
  // TOLERANCIA: el banco liquida interés por días reales, así que el débito
  // casi nunca coincide al peso con la cuota esperada. Un pago entre el 95%
  // y el 110% de la cuota la cierra completa (el excedente es interés de esa
  // cuota; el faltante son días de menos). Antes un débito 1% menor dejaba la
  // cuota "parcial" y el pago del mes siguiente se partía en dos.
  const sortedPayments = payments.slice().sort((a, b) => a.payment_date.localeCompare(b.payment_date));
  const normalQueue = sortedPayments
    .filter((p) => !p.is_extra)
    .map((p) => ({
      total: Number(p.amount_paid || 0),
      capital: Number(p.principal_paid || 0),
      interes: Number(p.interest_paid || 0),
    }));
  const extras = sortedPayments.filter((p) => p.is_extra);
  const capitalFijo = input.type === 'alemana' && input.termMonths > 0
    ? input.principal / input.termMonths
    : null;

  const scheduleWithStatus: AmortizationRowWithStatus[] = [];
  let saldoReal = input.principal;
  const i = input.interestRateMonthlyPct / 100;
  let qIdx = 0;
  let eIdx = 0;
  let saldado = false;
  for (let idx = 0; idx < schedule.length; idx++) {
    const row = schedule[idx];
    const esUltima = idx === schedule.length - 1;
    // Ventana de esta cuota: desde su fecha hasta ANTES de la siguiente.
    const nextFecha = schedule[idx + 1]?.fecha ?? '9999-12-31';
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
        pagadoNormal: 0,
        capitalEfectivo: 0,
        interesEfectivo: 0,
        abonoExtraCapital: 0,
        recalculada: true,
      });
      continue;
    }

    // 0. Interés esperado: sobre el saldo al inicio de la ventana (corte).
    const saldoInicio = saldoReal;
    const interesEsperado = saldoInicio * i;

    // 1. Abonos extra de la VENTANA de esta cuota (fecha < próxima cuota) →
    //    bajan el saldo directo y se muestran en ESTA fila. Un abono del
    //    19-ago (después de la cuota del 15-ago, antes de la del 15-sep)
    //    aparece junto a la cuota 1 y el interés de la 2 ya sale rebajado.
    let extraCapital = 0;
    let extraTotal = 0;
    while (eIdx < extras.length && extras[eIdx].payment_date < nextFecha) {
      extraCapital += Number(extras[eIdx].principal_paid || 0);
      extraTotal += Number(extras[eIdx].amount_paid || 0);
      eIdx++;
    }
    saldoReal = Math.max(0, saldoReal - extraCapital);

    // Capital esperado según el tipo (nunca más que el saldo que queda).
    let capitalEsperado: number;
    if (capitalFijo !== null) {
      capitalEsperado = Math.min(capitalFijo, saldoReal);
    } else if (input.type === 'bullet') {
      capitalEsperado = esUltima ? saldoReal : 0;
    } else {
      capitalEsperado = Math.min(saldoReal, Math.max(0, row.cuotaTotal - interesEsperado));
    }
    if (esUltima) capitalEsperado = saldoReal; // la última siempre cierra en 0
    const cuotaEsperada = capitalEsperado + interesEsperado;

    // 2. FIFO: consumir pagos normales hasta cubrir la cuota esperada. Si un
    //    pago sobra por más de la tolerancia, el resto queda en la cola para
    //    la cuota siguiente (capital/interés se reparten proporcionalmente).
    const tolAlta = Math.max(0.5, cuotaEsperada * 0.10);
    const tolBaja = Math.max(0.5, cuotaEsperada * 0.05);
    let consTotal = 0;
    let consCapital = 0;
    let consInteres = 0;
    while (qIdx < normalQueue.length && consTotal < cuotaEsperada - tolBaja) {
      const p = normalQueue[qIdx];
      const falta = cuotaEsperada - consTotal;
      if (p.total <= falta + tolAlta) {
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

    // Estado: solo los pagos normales "pagan" la cuota — un abono extra no la
    // marca pagada ni parcial (va a capital, no a la obligación del mes).
    let estado: CuotaEstado;
    if (consTotal >= cuotaEsperada - tolBaja) {
      estado = 'pagada';
    } else if (consTotal > 0) {
      estado = 'parcial';
    } else {
      estado = 'pendiente';
    }
    const pendiente = estado === 'pendiente';

    // Pendiente: se muestra lo esperado. Tocada: lo realmente pagado de la cuota.
    const capitalEfectivo = pendiente ? capitalEsperado : consCapital;
    const interesEfectivo = pendiente ? interesEsperado : consInteres;

    // ¿La cuota esperada difiere del plan original? (saldo real por debajo
    // del teórico al inicio de la ventana = hubo abono extra antes).
    const saldoTeoricoInicio = row.saldoRestante + row.capitalPagado;
    const recalculada = saldoInicio > 0 && saldoInicio < saldoTeoricoInicio - 0.5;

    // Proyección: una cuota pendiente descuenta su capital esperado del saldo.
    const saldoPost = pendiente ? saldoReal - capitalEsperado : saldoReal;
    if (saldoPost <= 0.5) {
      saldado = true; // las siguientes cuotas se marcarán como saldado
    }

    scheduleWithStatus.push({
      ...row,
      cuotaTotal: r2(cuotaEsperada),
      capitalPagado: r2(capitalEsperado),
      interesPagado: r2(interesEsperado),
      estado,
      saldoRealRestante: r2(Math.max(0, saldoPost)),
      pagadoEnCuota: r2(consTotal + extraTotal),
      pagadoNormal: r2(consTotal),
      capitalEfectivo: r2(capitalEfectivo),
      interesEfectivo: r2(interesEfectivo),
      abonoExtraCapital: r2(extraCapital),
      recalculada,
    });

    saldoReal = Math.max(0, saldoPost);
  }

  // Próxima cuota REAL: la primera no cubierta (pendiente o parcial), con lo
  // que FALTA pagar de ella (la cuota esperada completa si está pendiente).
  // Antes era "primera con fecha ≥ hoy", que ignoraba si ya estaba pagada — y
  // una cuota vieja impaga nunca aparecía como próxima.
  const next = scheduleWithStatus.find((r) => r.estado === 'pendiente' || r.estado === 'parcial') ?? null;
  const nextCuota: AmortizationRow | null = next
    ? {
        cuotaNumero: next.cuotaNumero,
        fecha: next.fecha,
        cuotaTotal: r2(Math.max(0, next.cuotaTotal - next.pagadoNormal)),
        capitalPagado: next.capitalPagado,
        interesPagado: next.interesPagado,
        saldoRestante: next.saldoRealRestante,
      }
    : null;

  // Intereses proyectados: lo ya pagado (real) + lo esperado de lo pendiente.
  // Reporte Nico 2026-09-16: "abono 20M y el costo total del crédito no
  // cambió" — antes el costo usaba los intereses del plan original.
  const totalInterestProjected = scheduleWithStatus.reduce((acc, r) => {
    if (r.estado === 'saldado') return acc;
    if (r.estado === 'pendiente') return acc + r.interesPagado;
    return acc + r.interesEfectivo;
  }, 0);
  const interestSavedVsPlan = Math.max(0, totalInterestScheduled - totalInterestProjected);
  const totalCreditCost = input.principal + totalInterestProjected + additionalCostsAmount;

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
    totalInterestProjected: r2(totalInterestProjected),
    interestSavedVsPlan: r2(interestSavedVsPlan),
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
 * Capital fijo mensual de un crédito ALEMÁN (principal / plazo). En ese tipo
 * el capital de cada cuota es fijo por contrato y el interés es lo que se
 * mueve (saldo, días). Null para francesa/bullet.
 */
export function capitalFijoMensual(c: {
  amortization_type: AmortizationType;
  principal: number;
  term_months: number;
}): number | null {
  if (c.amortization_type !== 'alemana') return null;
  const n = Number(c.term_months);
  if (!(n > 0)) return null;
  return Number(c.principal) / n;
}

/**
 * Sugiere la división capital/interés para un pago dado, basada en el saldo
 * actual y la tasa. Útil cuando el usuario registra un pago: el sistema
 * propone la separación pero el usuario puede ajustarla.
 *
 * Con `capitalFijo` (crédito alemán): el capital es el del contrato y el
 * interés absorbe la diferencia — el banco liquida por días reales, así que
 * el débito rara vez es saldo × tasa exacto. Antes la propuesta era interés =
 * saldo × tasa y capital = el resto, y el capital quedaba corrido por los
 * pesos de más de cada mes (cuota 1 de Nico: $4.191.493 en vez de $4.166.667).
 */
export function suggestPaymentSplit(
  currentBalance: number,
  monthlyRatePct: number,
  amountPaid: number,
  isExtra: boolean,
  capitalFijo?: number | null,
): { principal: number; interest: number } {
  if (isExtra) {
    const principalCapped = Math.min(amountPaid, currentBalance);
    return { principal: r2(principalCapped), interest: r2(amountPaid - principalCapped) };
  }
  const interesPlan = currentBalance * (monthlyRatePct / 100);
  if (capitalFijo != null && capitalFijo > 0) {
    const capitalPlan = Math.min(capitalFijo, currentBalance);
    if (amountPaid >= capitalPlan + interesPlan) {
      // Cuota completa (o con días/mora de más): capital del contrato, resto interés.
      return { principal: r2(capitalPlan), interest: r2(amountPaid - capitalPlan) };
    }
    // Pago corto: el banco cobra primero el interés.
    const interest = Math.min(amountPaid, interesPlan);
    return { principal: r2(amountPaid - interest), interest: r2(interest) };
  }
  const principal = Math.max(0, amountPaid - interesPlan);
  // No dejar que el capital exceda el saldo
  const principalCapped = Math.min(principal, currentBalance);
  const interestActual = amountPaid - principalCapped;
  return {
    principal: r2(principalCapped),
    interest: r2(interestActual),
  };
}
