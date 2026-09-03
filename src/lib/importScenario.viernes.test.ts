import { describe, it, expect } from 'vitest';
import { viernesAduana, escenarioVigente } from './importScenario';

describe('viernesAduana — TRM de liquidación DIAN (último viernes previo a la semana del arribo)', () => {
  it('arribo martes 2026-09-01 → viernes 2026-08-28', () => {
    expect(viernesAduana('2026-09-01')).toBe('2026-08-28');
  });
  it('arribo lunes → el viernes de la semana ANTERIOR (no el de su propia semana)', () => {
    expect(viernesAduana('2026-08-31')).toBe('2026-08-28');
  });
  it('arribo viernes → el viernes anterior (la certificada ese día rige la semana siguiente)', () => {
    expect(viernesAduana('2026-09-04')).toBe('2026-08-28');
  });
  it('arribo domingo → el viernes de su misma semana ISO', () => {
    expect(viernesAduana('2026-09-06')).toBe('2026-08-28');
  });
  it('sin fecha → null', () => {
    expect(viernesAduana(null)).toBeNull();
    expect(viernesAduana('')).toBeNull();
  });
});

describe('escenarioVigente — saldoUsdReal manda (mismo número que Pedidos)', () => {
  const base = {
    mercanciaUsd: 125_028,
    costs: [] as never[],
    trmSimulada: 3141,
    arancelPct: 5,
    ivaPct: 19,
  };
  it('con saldoUsdReal, el saldo es EXACTAMENTE el de Pedidos aunque los abonos digan otra cosa', () => {
    const esc = escenarioVigente({
      ...base,
      abonos: [{ amount_usd: 84_000, trm: 3150 }, { amount_usd: 5_000, trm: 3100 }],
      saldoUsdReal: 41_000,
    });
    expect(esc.saldoUsd).toBe(41_000);
    expect(esc.saldoCopSimulado).toBe(41_000 * 3141);
  });
  it('sin saldoUsdReal cae al cálculo mercancía − abonos (fallback)', () => {
    const esc = escenarioVigente({ ...base, abonos: [{ amount_usd: 84_000, trm: 3150 }] });
    expect(esc.saldoUsd).toBeCloseTo(125_028 - 84_000, 2);
  });
  it('saldoUsdReal negativo (sobrepago) se floorea en 0', () => {
    const esc = escenarioVigente({ ...base, abonos: [], saldoUsdReal: -500 });
    expect(esc.saldoUsd).toBe(0);
  });
});
