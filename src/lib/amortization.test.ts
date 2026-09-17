/**
 * Amortización — calibrado contra el crédito REAL de Nico (2026-08-08):
 * $100.000.000, 24 meses, 1.33% MV, desembolso 6/07/2026, ALEMANA
 * (capital constante $4.166.667, cuota decreciente).
 */

import { describe, it, expect } from 'vitest';
import { buildAmortization, simulateExtraPayment, summarizeCredit, suggestPaymentSplit, capitalFijoMensual } from './amortization';

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
    // El abono va a capital: la obligación del mes sigue viva y la fila
    // sigue mostrando la cuota esperada (no el abono como si fuera la cuota).
    expect(s.scheduleWithStatus[0].estado).toBe('pendiente');
    expect(s.scheduleWithStatus[0].abonoExtraCapital).toBe(10_000_000);
    expect(s.scheduleWithStatus[0].capitalEfectivo).toBeCloseTo(4_166_666.67, 0);
    expect(s.scheduleWithStatus[0].interesEfectivo).toBeCloseTo(1_330_000, 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Crédito REAL de Nico (2026-09-16): $100M, 24 meses, 1.37% MV, ALEMANA,
// primera cuota 15-ago-2026. Cuota 1 debitada el 19-ago por $5.561.493 y ese
// mismo día abono extra de $10M. Bancolombia cobró la cuota 2 en $5.384.239.
// ─────────────────────────────────────────────────────────────────────────────
const NICO = {
  principal: 100_000_000,
  interestRateMonthlyPct: 1.37,
  termMonths: 24,
  firstPaymentDate: '2026-08-15',
  type: 'alemana' as const,
};
const CUOTA1 = { payment_date: '2026-08-19', amount_paid: 5_561_493, principal_paid: 4_191_493, interest_paid: 1_370_000, is_extra: false };
const ABONO1 = { payment_date: '2026-08-19', amount_paid: 10_000_000, principal_paid: 10_000_000, interest_paid: 0, is_extra: true };

describe('alemana + abono extra: el capital sigue FIJO y solo baja el interés (fix 2026-09-16)', () => {
  const s = summarizeCredit(NICO, [CUOTA1, ABONO1]);
  const [r1, r2, r3] = s.scheduleWithStatus;

  it('cuota 1 pagada muestra lo que realmente se pagó (no el plan)', () => {
    expect(r1.estado).toBe('pagada');
    expect(r1.capitalEfectivo).toBe(4_191_493);
    expect(r1.interesEfectivo).toBe(1_370_000);
    expect(r1.pagadoNormal).toBe(5_561_493);
    expect(r1.abonoExtraCapital).toBe(10_000_000);
    expect(r1.saldoRealRestante).toBe(85_808_507);
  });

  it('cuota 2: capital fijo $4.166.667 + interés sobre $85.808.507 = $5.342.244 (antes: $5.479.583)', () => {
    expect(r2.estado).toBe('pendiente');
    expect(r2.recalculada).toBe(true);
    expect(r2.capitalPagado).toBeCloseTo(4_166_666.67, 0);
    expect(r2.interesPagado).toBeCloseTo(85_808_507 * 0.0137, 0);
    expect(r2.cuotaTotal).toBeCloseTo(5_342_243.5, 0);
    expect(r2.cuotaTotal).toBeLessThan(5_400_000);
  });

  it('la próxima cuota (KPI, modal, conciliación) es la esperada, no la teórica', () => {
    expect(s.nextCuota?.cuotaNumero).toBe(2);
    expect(s.nextCuota?.cuotaTotal).toBe(r2.cuotaTotal);
  });

  it('las cuotas siguientes bajan sólo por el interés (capital constante)', () => {
    expect(r3.capitalPagado).toBeCloseTo(4_166_666.67, 0);
    expect(r2.cuotaTotal - r3.cuotaTotal).toBeCloseTo(4_166_666.67 * 0.0137, 0);
  });

  it('el crédito termina antes: $85.8M / $4.166.667 = 20,6 cuotas → la 22 cierra y 23-24 quedan saldadas', () => {
    const estados = s.scheduleWithStatus.map((r) => r.estado);
    expect(estados[21]).toBe('pendiente');
    expect(s.scheduleWithStatus[21].capitalPagado).toBeCloseTo(85_808_507 - 20 * (100_000_000 / 24), 0);
    expect(s.scheduleWithStatus[21].saldoRealRestante).toBe(0);
    expect(estados[22]).toBe('saldado');
    expect(estados[23]).toBe('saldado');
  });

  it('registrar el débito REAL del banco ($5.384.239) cierra la cuota 2 y no contamina la 3', () => {
    const CUOTA2 = { payment_date: '2026-09-15', amount_paid: 5_384_239, principal_paid: 4_166_667, interest_paid: 1_217_572, is_extra: false };
    const s2 = summarizeCredit(NICO, [CUOTA1, ABONO1, CUOTA2]);
    expect(s2.scheduleWithStatus[1].estado).toBe('pagada');
    expect(s2.scheduleWithStatus[1].pagadoNormal).toBe(5_384_239);
    expect(s2.scheduleWithStatus[2].estado).toBe('pendiente');
    expect(s2.nextCuota?.cuotaNumero).toBe(3);
    expect(s2.currentBalance).toBe(81_641_840);
    // Cuota 3 esperada sobre el saldo real nuevo
    expect(s2.scheduleWithStatus[2].interesPagado).toBeCloseTo(81_641_840 * 0.0137, 0);
  });

  it('un débito unos pesos MENOR a la cuota esperada (menos días) también la cierra', () => {
    const corta = { payment_date: '2026-09-15', amount_paid: 5_300_000, principal_paid: 4_166_667, interest_paid: 1_133_333, is_extra: false };
    const cuota3 = { payment_date: '2026-10-15', amount_paid: 5_290_000, principal_paid: 4_166_667, interest_paid: 1_123_333, is_extra: false };
    const s2 = summarizeCredit(NICO, [CUOTA1, ABONO1, corta, cuota3]);
    expect(s2.scheduleWithStatus[1].estado).toBe('pagada');
    // Antes: la 2 quedaba "parcial" y el pago de la 3 se partía para rellenarla
    expect(s2.scheduleWithStatus[2].estado).toBe('pagada');
    expect(s2.scheduleWithStatus[2].pagadoNormal).toBe(5_290_000);
    expect(s2.scheduleWithStatus[3].estado).toBe('pendiente');
  });

  it('un pago a la mitad sigue siendo parcial', () => {
    const mitad = { payment_date: '2026-09-15', amount_paid: 2_700_000, principal_paid: 1_524_423, interest_paid: 1_175_577, is_extra: false };
    const s2 = summarizeCredit(NICO, [CUOTA1, ABONO1, mitad]);
    expect(s2.scheduleWithStatus[1].estado).toBe('parcial');
    expect(s2.nextCuota?.cuotaNumero).toBe(2);
    expect(s2.nextCuota?.cuotaTotal).toBeCloseTo(s2.scheduleWithStatus[1].cuotaTotal - 2_700_000, 0);
  });
});

describe('francesa y bullet no se rompieron con la cuota esperada', () => {
  it('francesa: la cuota se mantiene fija tras un abono y el capital sube', () => {
    const FR = { ...NICO, type: 'francesa' as const };
    const plan = buildAmortization(FR);
    const s = summarizeCredit(FR, [
      { payment_date: '2026-08-15', amount_paid: plan[0].cuotaTotal, principal_paid: plan[0].capitalPagado, interest_paid: plan[0].interesPagado, is_extra: false },
      ABONO1,
    ]);
    const r2 = s.scheduleWithStatus[1];
    expect(r2.cuotaTotal).toBeCloseTo(plan[1].cuotaTotal, 0);
    expect(r2.capitalPagado).toBeGreaterThan(plan[1].capitalPagado);
  });

  it('bullet: sólo interés sobre el saldo real; el capital va en la última', () => {
    const BU = { ...NICO, termMonths: 3, type: 'bullet' as const };
    const s = summarizeCredit(BU, [ABONO1]);
    expect(s.scheduleWithStatus[0].capitalPagado).toBe(0);
    expect(s.scheduleWithStatus[0].cuotaTotal).toBeCloseTo(100_000_000 * 0.0137, 0);
    expect(s.scheduleWithStatus[1].cuotaTotal).toBeCloseTo(90_000_000 * 0.0137, 0);
    expect(s.scheduleWithStatus[2].capitalPagado).toBe(90_000_000);
  });
});

describe('suggestPaymentSplit con capital fijo (alemana)', () => {
  it('el débito del banco se parte con el capital del contrato y el resto a interés', () => {
    const split = suggestPaymentSplit(85_808_507, 1.37, 5_384_239, false, capitalFijoMensual({ amortization_type: 'alemana', principal: 100_000_000, term_months: 24 }));
    expect(split.principal).toBeCloseTo(4_166_666.67, 0);
    expect(split.interest).toBeCloseTo(5_384_239 - 4_166_666.67, 0);
  });

  it('un pago corto paga primero el interés', () => {
    const split = suggestPaymentSplit(85_808_507, 1.37, 2_000_000, false, 4_166_666.67);
    expect(split.interest).toBeCloseTo(85_808_507 * 0.0137, 0);
    expect(split.principal).toBeCloseTo(2_000_000 - 85_808_507 * 0.0137, 0);
  });

  it('sin capital fijo (francesa) sigue igual: interés = saldo × tasa', () => {
    const split = suggestPaymentSplit(85_808_507, 1.37, 5_384_239, false, capitalFijoMensual({ amortization_type: 'francesa', principal: 100_000_000, term_months: 24 }));
    expect(split.interest).toBeCloseTo(85_808_507 * 0.0137, 0);
  });

  it('abono extra: todo a capital', () => {
    const split = suggestPaymentSplit(85_808_507, 1.37, 10_000_000, true, 4_166_666.67);
    expect(split).toEqual({ principal: 10_000_000, interest: 0 });
  });
});
