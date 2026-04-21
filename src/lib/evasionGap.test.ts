import { describe, it, expect } from 'vitest';
import { calculateEvasionGap, levelFromPct, EVASION_THRESHOLDS } from './evasionGap';

describe('calculateEvasionGap', () => {
  it('sin ingresos devuelve todo en 0 y level low', () => {
    const r = calculateEvasionGap({ bankIncome: 0, invoicedIncome: 0, cashIncome: 0 });
    expect(r.real).toBe(0);
    expect(r.dian).toBe(0);
    expect(r.pendingBank).toBe(0);
    expect(r.cash).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('banco 100% facturado, sin efectivo → gap = 0 y level low', () => {
    const r = calculateEvasionGap({ bankIncome: 100_000_000, invoicedIncome: 100_000_000, cashIncome: 0 });
    expect(r.real).toBe(100_000_000);
    expect(r.dian).toBe(100_000_000);
    expect(r.pendingBank).toBe(0);
    expect(r.cash).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('solo efectivo → gap = real y level high (100%)', () => {
    const r = calculateEvasionGap({ bankIncome: 0, invoicedIncome: 0, cashIncome: 50_000_000 });
    expect(r.real).toBe(50_000_000);
    expect(r.dian).toBe(0);
    expect(r.pendingBank).toBe(0);
    expect(r.cash).toBe(50_000_000);
    expect(r.gap).toBe(50_000_000);
    expect(r.gapPct).toBe(1);
    expect(r.level).toBe('high');
  });

  it('banco sin facturar + sin efectivo → gap = pendingBank y level high (100%)', () => {
    // Todo pasó por banco pero nada está facturado. Tributariamente igual de invisible.
    const r = calculateEvasionGap({ bankIncome: 80_000_000, invoicedIncome: 0, cashIncome: 0 });
    expect(r.real).toBe(80_000_000);
    expect(r.dian).toBe(0);
    expect(r.pendingBank).toBe(80_000_000);
    expect(r.gap).toBe(80_000_000);
    expect(r.gapPct).toBe(1);
    expect(r.level).toBe('high');
  });

  it('caso real del usuario: 562M banco (488M facturados + 74M pendientes) + 15M efectivo', () => {
    const r = calculateEvasionGap({
      bankIncome: 562_000_000,
      invoicedIncome: 488_000_000,
      cashIncome: 15_000_000,
    });
    expect(r.real).toBe(577_000_000);
    expect(r.dian).toBe(488_000_000);
    expect(r.pendingBank).toBe(74_000_000);
    expect(r.cash).toBe(15_000_000);
    expect(r.gap).toBe(89_000_000);
    expect(r.gapPct).toBeCloseTo(89 / 577, 5);
    // 15.4% → mid
    expect(r.level).toBe('mid');
  });

  it('mix 10% no facturado (todo pendiente bancario) → level low', () => {
    const r = calculateEvasionGap({ bankIncome: 100, invoicedIncome: 90, cashIncome: 0 });
    expect(r.gapPct).toBeCloseTo(0.1, 5);
    expect(r.level).toBe('low');
  });

  it('mix 20% efectivo → level mid', () => {
    const r = calculateEvasionGap({ bankIncome: 80, invoicedIncome: 80, cashIncome: 20 });
    expect(r.gapPct).toBeCloseTo(0.2, 5);
    expect(r.level).toBe('mid');
  });

  it('mix 40% (mitad pendiente bancario, mitad efectivo) → level high', () => {
    const r = calculateEvasionGap({ bankIncome: 80, invoicedIncome: 60, cashIncome: 20 });
    expect(r.real).toBe(100);
    expect(r.pendingBank).toBe(20);
    expect(r.cash).toBe(20);
    expect(r.gap).toBe(40);
    expect(r.gapPct).toBeCloseTo(0.4, 5);
    expect(r.level).toBe('high');
  });

  it('los umbrales son inclusivos en su límite inferior', () => {
    // Exactamente 15% → mid (inclusivo)
    const r15 = calculateEvasionGap({ bankIncome: 85, invoicedIncome: 85, cashIncome: 15 });
    expect(r15.level).toBe('mid');

    // Exactamente 35% → high (inclusivo)
    const r35 = calculateEvasionGap({ bankIncome: 65, invoicedIncome: 65, cashIncome: 35 });
    expect(r35.level).toBe('high');
  });

  it('inputs negativos o NaN colapsan a 0 (robustez ante datos sucios)', () => {
    const r = calculateEvasionGap({ bankIncome: -100, invoicedIncome: NaN, cashIncome: NaN });
    expect(r.real).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.level).toBe('low');
  });

  it('invoicedIncome > bankIncome se clampa (caso imposible por datos sucios)', () => {
    // Si por algún bug llegara facturado > banco, no debe romper el cálculo
    // ni generar pendingBank negativo.
    const r = calculateEvasionGap({ bankIncome: 100, invoicedIncome: 150, cashIncome: 0 });
    expect(r.dian).toBe(100); // clampado
    expect(r.pendingBank).toBe(0); // nunca negativo
    expect(r.gap).toBe(0);
  });

  it('gap nunca es negativo', () => {
    const r = calculateEvasionGap({ bankIncome: 100, invoicedIncome: 100, cashIncome: 0 });
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
