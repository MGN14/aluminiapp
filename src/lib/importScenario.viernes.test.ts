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
  it('saldoUsdReal manda sobre mercancía − abonos (ancla a Pedidos)', () => {
    const esc = escenarioVigente({
      ...base,
      abonos: [{ amount_usd: 84_000, trm: 3150 }],
      saldoUsdReal: 41_000,
    });
    expect(esc.saldoUsd).toBe(41_000);
    expect(esc.saldoCopSimulado).toBe(41_000 * 3141);
  });

  it('CASO REAL 2026-2 (Excel de Nico): 41.924 con flete y 36.114 sin flete', () => {
    // Mercancía 125.028 + flete 5.700 + seguro 110 = 130.838
    // Pagado: 22.000 + 32.000 + 30.000 (banco) + 4.914 (Pocillos, por fuera)
    // → Balance no freight 36.114 · Saldo Con freight 41.924
    const saldoPedidos = 125_028 - 84_000;           // lo que muestra Pedidos
    const esc = escenarioVigente({
      ...base,
      abonos: [
        { amount_usd: 22_000, trm: 3150 }, { amount_usd: 32_000, trm: 3150 },
        { amount_usd: 30_000, trm: 3150 }, { amount_usd: 4_914, trm: 3100 },
      ],
      saldoUsdReal: Math.max(0, saldoPedidos - 4_914),  // − pagos por fuera
      fleteSeguroUsd: 5_700 + 110,
    });
    expect(esc.saldoUsdMercancia).toBe(36_114);
    expect(esc.saldoUsd).toBe(41_924);
    expect(esc.fleteSeguroUsd).toBe(5_810);
  });

  it('sin flete/seguro, saldoUsd == saldoUsdMercancia', () => {
    const esc = escenarioVigente({ ...base, abonos: [], saldoUsdReal: 10_000 });
    expect(esc.saldoUsd).toBe(10_000);
    expect(esc.saldoUsdMercancia).toBe(10_000);
    expect(esc.fleteSeguroUsd).toBe(0);
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
