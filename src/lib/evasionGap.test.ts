import { describe, it, expect } from 'vitest';
import { calculateEvasionGap, levelFromPct, EVASION_THRESHOLDS } from './evasionGap';

describe('calculateEvasionGap', () => {
  it('sin ingresos devuelve todo en 0 y level low', () => {
    const r = calculateEvasionGap({
      bankIncome: 0,
      previousPeriodAdvances: 0,
      cashIncome: 0,
      invoicedAmount: 0,
    });
    expect(r.real).toBe(0);
    expect(r.dian).toBe(0);
    expect(r.bankIncome).toBe(0);
    expect(r.previousPeriodAdvances).toBe(0);
    expect(r.cash).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('todo cobrado con factura emitida (real = dian) → gap = 0 y level low', () => {
    const r = calculateEvasionGap({
      bankIncome: 100_000_000,
      previousPeriodAdvances: 0,
      cashIncome: 0,
      invoicedAmount: 100_000_000,
    });
    expect(r.real).toBe(100_000_000);
    expect(r.dian).toBe(100_000_000);
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('solo efectivo sin facturar → gap = real, level high (100%)', () => {
    const r = calculateEvasionGap({
      bankIncome: 0,
      previousPeriodAdvances: 0,
      cashIncome: 50_000_000,
      invoicedAmount: 0,
    });
    expect(r.real).toBe(50_000_000);
    expect(r.dian).toBe(0);
    expect(r.cash).toBe(50_000_000);
    expect(r.gap).toBe(50_000_000);
    expect(r.gapPct).toBe(1);
    expect(r.level).toBe('high');
  });

  it('solo anticipos viejos sin facturar → gap = real, level high', () => {
    const r = calculateEvasionGap({
      bankIncome: 0,
      previousPeriodAdvances: 80_000_000,
      cashIncome: 0,
      invoicedAmount: 0,
    });
    expect(r.real).toBe(80_000_000);
    expect(r.previousPeriodAdvances).toBe(80_000_000);
    expect(r.gap).toBe(80_000_000);
    expect(r.gapPct).toBe(1);
    expect(r.level).toBe('high');
  });

  it('caso real del usuario: 562M extracto + 300M anticipos prev + 15M efectivo, 488M facturado', () => {
    const r = calculateEvasionGap({
      bankIncome: 562_000_000,
      previousPeriodAdvances: 300_000_000,
      cashIncome: 15_000_000,
      invoicedAmount: 488_000_000,
    });
    expect(r.real).toBe(877_000_000);
    expect(r.dian).toBe(488_000_000);
    expect(r.bankIncome).toBe(562_000_000);
    expect(r.previousPeriodAdvances).toBe(300_000_000);
    expect(r.cash).toBe(15_000_000);
    expect(r.gap).toBe(389_000_000);
    expect(r.gapPct).toBeCloseTo(389 / 877, 5);
    // 44.4% → high
    expect(r.level).toBe('high');
  });

  it('facturas emitidas > real (cuentas por cobrar) → gap se clampa a 0', () => {
    // Facturé 1000 pero solo cobré 500 (el resto me lo deben).
    // No hay evasión: hay cartera. Gap debe ser 0.
    const r = calculateEvasionGap({
      bankIncome: 500,
      previousPeriodAdvances: 0,
      cashIncome: 0,
      invoicedAmount: 1000,
    });
    expect(r.real).toBe(500);
    expect(r.dian).toBe(500); // clampado al real
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('mix 10% no facturado → level low', () => {
    const r = calculateEvasionGap({
      bankIncome: 90,
      previousPeriodAdvances: 0,
      cashIncome: 10,
      invoicedAmount: 90,
    });
    expect(r.gapPct).toBeCloseTo(0.1, 5);
    expect(r.level).toBe('low');
  });

  it('mix 20% no facturado → level mid', () => {
    const r = calculateEvasionGap({
      bankIncome: 80,
      previousPeriodAdvances: 0,
      cashIncome: 20,
      invoicedAmount: 80,
    });
    expect(r.gapPct).toBeCloseTo(0.2, 5);
    expect(r.level).toBe('mid');
  });

  it('mix 40% no facturado → level high', () => {
    const r = calculateEvasionGap({
      bankIncome: 60,
      previousPeriodAdvances: 0,
      cashIncome: 40,
      invoicedAmount: 60,
    });
    expect(r.gapPct).toBeCloseTo(0.4, 5);
    expect(r.level).toBe('high');
  });

  it('umbrales inclusivos en su límite inferior', () => {
    // 15% exacto → mid
    const r15 = calculateEvasionGap({
      bankIncome: 85,
      previousPeriodAdvances: 0,
      cashIncome: 15,
      invoicedAmount: 85,
    });
    expect(r15.level).toBe('mid');

    // 35% exacto → high
    const r35 = calculateEvasionGap({
      bankIncome: 65,
      previousPeriodAdvances: 0,
      cashIncome: 35,
      invoicedAmount: 65,
    });
    expect(r35.level).toBe('high');
  });

  it('inputs negativos o NaN colapsan a 0 (robustez)', () => {
    const r = calculateEvasionGap({
      bankIncome: -100,
      previousPeriodAdvances: NaN,
      cashIncome: NaN,
      invoicedAmount: -50,
    });
    expect(r.real).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.level).toBe('low');
  });

  it('gap nunca es negativo', () => {
    const r = calculateEvasionGap({
      bankIncome: 100,
      previousPeriodAdvances: 50,
      cashIncome: 0,
      invoicedAmount: 200,
    });
    expect(r.gap).toBeGreaterThanOrEqual(0);
  });

  it('levelFromPct respeta los umbrales exportados', () => {
    expect(levelFromPct(0)).toBe('low');
    expect(levelFromPct(EVASION_THRESHOLDS.mid - 0.0001)).toBe('low');
    expect(levelFromPct(EVASION_THRESHOLDS.mid)).toBe('mid');
    expect(levelFromPct(EVASION_THRESHOLDS.high - 0.0001)).toBe('mid');
    expect(levelFromPct(EVASION_THRESHOLDS.high)).toBe('high');
    expect(levelFromPct(1)).toBe('high');
  });
});
