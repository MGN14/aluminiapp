import { describe, it, expect } from 'vitest';
import { calculateEvasionGap, levelFromPct, EVASION_THRESHOLDS } from './evasionGap';

describe('calculateEvasionGap', () => {
  it('sin ingresos devuelve todo en 0 y level low', () => {
    const r = calculateEvasionGap({ bankIncome: 0, cashIncome: 0 });
    expect(r.real).toBe(0);
    expect(r.dian).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('solo banco, sin efectivo → gap = 0 y level low', () => {
    const r = calculateEvasionGap({ bankIncome: 100_000_000, cashIncome: 0 });
    expect(r.real).toBe(100_000_000);
    expect(r.dian).toBe(100_000_000);
    expect(r.gap).toBe(0);
    expect(r.gapPct).toBe(0);
    expect(r.level).toBe('low');
  });

  it('solo efectivo → gap = real y level high (100%)', () => {
    const r = calculateEvasionGap({ bankIncome: 0, cashIncome: 50_000_000 });
    expect(r.real).toBe(50_000_000);
    expect(r.dian).toBe(0);
    expect(r.gap).toBe(50_000_000);
    expect(r.gapPct).toBe(1);
    expect(r.level).toBe('high');
  });

  it('mix 10% efectivo → level low (bajo el umbral mid de 15%)', () => {
    const r = calculateEvasionGap({ bankIncome: 90, cashIncome: 10 });
    expect(r.gapPct).toBeCloseTo(0.1, 5);
    expect(r.level).toBe('low');
  });

  it('mix 20% efectivo → level mid', () => {
    const r = calculateEvasionGap({ bankIncome: 80, cashIncome: 20 });
    expect(r.gapPct).toBeCloseTo(0.2, 5);
    expect(r.level).toBe('mid');
  });

  it('mix 40% efectivo → level high', () => {
    const r = calculateEvasionGap({ bankIncome: 60, cashIncome: 40 });
    expect(r.gapPct).toBeCloseTo(0.4, 5);
    expect(r.level).toBe('high');
  });

  it('los umbrales son inclusivos en su límite inferior', () => {
    // Exactamente 15% → mid (inclusivo)
    const r15 = calculateEvasionGap({ bankIncome: 85, cashIncome: 15 });
    expect(r15.level).toBe('mid');

    // Exactamente 35% → high (inclusivo)
    const r35 = calculateEvasionGap({ bankIncome: 65, cashIncome: 35 });
    expect(r35.level).toBe('high');
  });

  it('inputs negativos o NaN colapsan a 0 (robustez ante datos sucios)', () => {
    const r = calculateEvasionGap({ bankIncome: -100, cashIncome: NaN });
    expect(r.real).toBe(0);
    expect(r.gap).toBe(0);
    expect(r.level).toBe('low');
  });

  it('gap nunca es negativo aunque DIAN > real (teóricamente imposible)', () => {
    // Caso defensivo: si algún día se refactoriza y queda inconsistente
    const r = calculateEvasionGap({ bankIncome: 100, cashIncome: 0 });
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
