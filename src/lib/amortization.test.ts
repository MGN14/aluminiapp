/**
 * Amortización — calibrado contra el crédito REAL de Nico (2026-08-08):
 * $100.000.000, 24 meses, 1.33% MV, desembolso 6/07/2026, ALEMANA
 * (capital constante $4.166.667, cuota decreciente).
 */

import { describe, it, expect } from 'vitest';
import { buildAmortization, simulateExtraPayment, summarizeCredit } from './amortization';

const CREDITO = {
  principal: 100_000_000,
  interestRateMonthlyPct: 1.33,
  termMonths: 24,
  firstPaymentDate: '2026-08-06',
  type: 'alemana' as const,
};

describe('alemana — la tabla del banco', () => {
  const rows = buildAmortization(CREDITO);

  it('24 cuotas con capital constante de $4.166.667', () => {
    expect(rows).toHaveLength(24);
    for (const r of rows.slice(0, 23)) expect(Math.round(r.capitalPagado)).toBe(4_166_667);
  });

  it('la cuota decrece y el saldo llega exactamente a 0', () => {
    expect(rows[0].cuotaTotal).toBeGreaterThan(rows[23].cuotaTotal);
    expect(Math.round(rows[23].saldoRestante)).toBe(0);
  });

  it('la última cuota coincide con el banco ($4.222.066, diferencia < $100)', () => {
    expect(Math.abs(rows[23].cuotaTotal - 4_222_066)).toBeLessThan(100);
  });

  it('el total de intereses queda dentro del 2% de lo que liquida el banco', () => {
    // Banco (Actual/360, días reales): $16.891.248.
    const total = rows.reduce((s, r) => s + r.interesPagado, 0);
    expect(Math.abs(total - 16_891_248) / 16_891_248).toBeLessThan(0.02);
  });

  it('la primera cuota se parece a la del banco ($5.540.569)', () => {
    expect(Math.abs(rows[0].cuotaTotal - 5_540_569)).toBeLessThan(60_000);
  });
});

describe('abonos a capital en alemana', () => {
  it('un abono de $10M salta 2 cuotas completas (capital fijo $4.166.667)', () => {
    const r = simulateExtraPayment(100_000_000, 1.33, 24, 10_000_000, 'alemana');
    expect(r.newBalance).toBe(90_000_000);
    expect(r.monthsSavedReducingTerm).toBe(2); // 10M / 4.166.667 = 2,4 → 2 cuotas enteras
    expect(r.interestSavedReducingTerm).toBeGreaterThan(0);
  });

  it('un abono que cubre el saldo entero cancela el crédito', () => {
    const r = simulateExtraPayment(100_000_000, 1.33, 24, 100_000_000, 'alemana');
    expect(r.newBalance).toBe(0);
  });

  it('reducir plazo ahorra MÁS intereses que mantener plazo', () => {
    const r = simulateExtraPayment(100_000_000, 1.33, 24, 20_000_000, 'alemana');
    expect(r.monthsSavedReducingTerm).toBe(4);
    expect(r.interestSavedReducingTerm).toBeGreaterThanOrEqual(r.interestSavedKeepingTerm);
  });

  it('francesa sigue calculando sus meses ahorrados (no se rompió)', () => {
    const r = simulateExtraPayment(100_000_000, 1.33, 24, 20_000_000, 'francesa');
    expect(r.monthsSavedReducingTerm).toBeGreaterThan(0);
  });
});

describe('summarizeCredit — el saldo sigue los pagos reales', () => {
  it('sin pagos, el saldo es el principal completo', () => {
    const s = summarizeCredit(CREDITO, []);
    expect(s.currentBalance).toBe(100_000_000);
    expect(s.percentPaid).toBe(0);
  });

  it('los intereses REALES del banco mandan sobre los teóricos', () => {
    // Cuota 1 tal como la liquidó el banco (Actual/360).
    const s = summarizeCredit(CREDITO, [{
      payment_date: '2026-08-06', amount_paid: 5_540_569,
      principal_paid: 4_166_667, interest_paid: 1_373_903, is_extra: false,
    }]);
    expect(s.currentBalance).toBe(95_833_333);
    expect(s.totalInterestPaid).toBe(1_373_903);
  });

  it('un abono extra adelanta el saldo real por debajo del teórico', () => {
    const s = summarizeCredit(CREDITO, [
      { payment_date: '2026-08-06', amount_paid: 5_540_569, principal_paid: 4_166_667, interest_paid: 1_373_903, is_extra: false },
      { payment_date: '2026-08-20', amount_paid: 20_000_000, principal_paid: 20_000_000, interest_paid: 0, is_extra: true },
    ]);
    expect(s.currentBalance).toBe(75_833_333);
    expect(s.percentPaid).toBeCloseTo(24.17, 1);
  });

  it('el costo total incluye los costos adicionales (el seguro del crédito)', () => {
    // Seguro $163.120 × 24 = $3.914.880 = 3.91% del principal.
    const s = summarizeCredit(CREDITO, [], 3.91);
    const sinSeguro = summarizeCredit(CREDITO, [], 0);
    expect(s.totalCreditCost - sinSeguro.totalCreditCost).toBeCloseTo(3_910_000, -4);
  });
});

describe('asignación de pagos a cuotas — FIFO por cuota impaga (fix 2026-08-19)', () => {
  // Caso real de Nico: cuota vencía el 15 pero por festivo el banco debitó
  // el 18. Con el bucket por fecha, el pago caía en la cuota SIGUIENTE.
  it('pago debitado 3 días tarde (festivo) paga la cuota vencida, no la siguiente', () => {
    const cuota1 = buildAmortization(CREDITO)[0];
    const s = summarizeCredit(CREDITO, [{
      payment_date: '2026-08-09', // 3 días después del vencimiento (06-ago)
      amount_paid: cuota1.cuotaTotal,
      principal_paid: cuota1.capitalPagado,
      interest_paid: cuota1.interesPagado,
      is_extra: false,
    }]);
    expect(s.scheduleWithStatus[0].estado).toBe('pagada');
    expect(s.scheduleWithStatus[1].estado).toBe('pendiente');
    // La próxima cuota es la #2, no la #1 ya cubierta
    expect(s.nextCuota?.cuotaNumero).toBe(2);
  });

  it('un pago grande cubre dos cuotas: ambas quedan pagadas', () => {
    const rows = buildAmortization(CREDITO);
    const doble = rows[0].cuotaTotal + rows[1].cuotaTotal;
    const s = summarizeCredit(CREDITO, [{
      payment_date: '2026-08-06',
      amount_paid: doble,
      principal_paid: rows[0].capitalPagado + rows[1].capitalPagado,
      interest_paid: rows[0].interesPagado + rows[1].interesPagado,
      is_extra: false,
    }]);
    expect(s.scheduleWithStatus[0].estado).toBe('pagada');
    expect(s.scheduleWithStatus[1].estado).toBe('pagada');
    expect(s.scheduleWithStatus[2].estado).toBe('pendiente');
  });

  it('un abono EXTRA no marca la cuota como pagada — baja el saldo', () => {
    const s = summarizeCredit(CREDITO, [{
      payment_date: '2026-08-06',
      amount_paid: 10_000_000,
      principal_paid: 10_000_000,
      interest_paid: 0,
      is_extra: true,
    }]);
    expect(s.scheduleWithStatus[0].estado).toBe('parcial'); // tocada pero la obligación del mes sigue viva
    expect(s.currentBalance).toBe(90_000_000);
  });

  it('pago parcial deja la cuota en parcial y el resto NO salta a la siguiente', () => {
    const cuota1 = buildAmortization(CREDITO)[0];
    const mitad = Math.round(cuota1.cuotaTotal / 2);
    const s = summarizeCredit(CREDITO, [{
      payment_date: '2026-08-06',
      amount_paid: mitad,
      principal_paid: Math.max(0, mitad - cuota1.interesPagado),
      interest_paid: Math.min(mitad, cuota1.interesPagado),
      is_extra: false,
    }]);
    expect(s.scheduleWithStatus[0].estado).toBe('parcial');
    expect(s.scheduleWithStatus[1].estado).toBe('pendiente');
  });
});

describe('liquidación real del banco y ventana de abonos (fix 2026-08-19 pt.2)', () => {
  it('el banco liquida MÁS que la cuota teórica (mora por festivo): la cuota queda pagada y NO contamina la siguiente', () => {
    const cuota1 = buildAmortization(CREDITO)[0];
    const moraExtra = 180_000; // ~3 días más de interés por débito corrido
    const s = summarizeCredit(CREDITO, [{
      payment_date: '2026-08-09',
      amount_paid: cuota1.cuotaTotal + moraExtra,
      principal_paid: cuota1.capitalPagado,
      interest_paid: cuota1.interesPagado + moraExtra,
      is_extra: false,
    }]);
    expect(s.scheduleWithStatus[0].estado).toBe('pagada');
    // Antes: el excedente caía como "parcial" en la cuota 2
    expect(s.scheduleWithStatus[1].estado).toBe('pendiente');
    expect(s.nextCuota?.cuotaNumero).toBe(2);
  });

  it('abono extra ENTRE cuota 1 y 2: aparece en la fila 1 (columna abono) y rebaja el interés de la 2', () => {
    const rows = buildAmortization(CREDITO);
    const cuota1 = rows[0];
    const s = summarizeCredit(CREDITO, [
      {
        payment_date: '2026-08-06',
        amount_paid: cuota1.cuotaTotal,
        principal_paid: cuota1.capitalPagado,
        interest_paid: cuota1.interesPagado,
        is_extra: false,
      },
      {
        // 13 días después de la cuota 1, antes de la 2 (06-sep)
        payment_date: '2026-08-19',
        amount_paid: 10_000_000,
        principal_paid: 10_000_000,
        interest_paid: 0,
        is_extra: true,
      },
    ]);
    // El abono se ve en la FILA de la cuota 1, no en la 2
    expect(s.scheduleWithStatus[0].abonoExtraCapital).toBe(10_000_000);
    expect(s.scheduleWithStatus[1].abonoExtraCapital).toBe(0);
    expect(s.scheduleWithStatus[0].estado).toBe('pagada');
    // Interés de la cuota 2 recalculado sobre el saldo rebajado
    const saldoTrasCuota1YAbono = 100_000_000 - cuota1.capitalPagado - 10_000_000;
    expect(s.scheduleWithStatus[1].interesEfectivo).toBeCloseTo(saldoTrasCuota1YAbono * 0.0133, 0);
    // Y el saldo real de la fila 1 ya refleja el abono
    expect(s.scheduleWithStatus[0].saldoRealRestante).toBe(saldoTrasCuota1YAbono);
  });
});
