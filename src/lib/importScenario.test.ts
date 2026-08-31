import { describe, it, expect } from 'vitest';
import { escenarioVigente } from './importScenario';
import { computeImportBreakdown } from './importCosting';

const COSTS = [
  { tipo: 'flete', monto: 5700, moneda: 'USD', trm: null },
  { tipo: 'seguro', monto: 110, moneda: 'USD', trm: null },
] as never[];

describe('escenarioVigente', () => {
  it('separa pagado (a sus TRMs) de saldo (a TRM simulada)', () => {
    const r = escenarioVigente({
      mercanciaUsd: 125_028,
      costs: COSTS,
      abonos: [
        { amount_usd: 40_000, trm: 3_800 },
        { amount_usd: 30_000, trm: 3_400 },
      ],
      trmSimulada: 3_057,
      arancelPct: 5,
      ivaPct: 19,
      cantidadKg: 28_850,
    });
    expect(r.pagadoUsd).toBe(70_000);
    expect(r.pagadoCop).toBe(40_000 * 3_800 + 30_000 * 3_400);
    expect(r.trmPonderadaPagado).toBeCloseTo((40_000 * 3_800 + 30_000 * 3_400) / 70_000, 6);
    expect(r.saldoUsd).toBe(55_028);
    expect(r.saldoCopSimulado).toBe(55_028 * 3_057);
    // La caja para cerrar = saldo + impuestos pendientes, nunca menos que el saldo.
    expect(r.cajaParaCerrarCop!).toBeGreaterThan(r.saldoCopSimulado!);
  });

  it('sin abonos, TODO va a la TRM simulada (= breakdown clásico)', () => {
    const base = { mercanciaUsd: 100_000, costs: COSTS, trmSimulada: 3_000, arancelPct: 5, ivaPct: 19 };
    const r = escenarioVigente({ ...base, abonos: [] });
    const clasico = computeImportBreakdown({
      mercanciaUsd: 100_000, costs: COSTS as never, trm: 3_000, arancelPct: 5, ivaPct: 19,
    });
    expect(r.breakdown.totalImportacionCop).toBe(clasico.totalImportacionCop);
    expect(r.saldoUsd).toBe(100_000);
  });

  it('pedido totalmente pagado: saldo 0 y la TRM simulada no mueve la mercancía', () => {
    const abonos = [{ amount_usd: 100_000, trm: 3_500 }];
    const a = escenarioVigente({ mercanciaUsd: 100_000, costs: COSTS, abonos, trmSimulada: 3_000, arancelPct: 5, ivaPct: 19 });
    const b = escenarioVigente({ mercanciaUsd: 100_000, costs: COSTS, abonos, trmSimulada: 4_000, arancelPct: 5, ivaPct: 19 });
    expect(a.saldoUsd).toBe(0);
    expect(a.saldoCopSimulado).toBe(0);
    // El CIF de mercancía queda anclado a lo pagado; solo flete/seguro (no
    // pagados como abonos) siguen a la TRM — la diferencia entre escenarios
    // debe ser exactamente flete+seguro × ΔTRM.
    const deltaEsperado = (5700 + 110) * 1_000;
    expect(b.breakdown.cifCop! - a.breakdown.cifCop!).toBeCloseTo(deltaEsperado, 0);
  });

  it('abonos que superan la factura no generan saldo negativo', () => {
    const r = escenarioVigente({
      mercanciaUsd: 50_000, costs: undefined,
      abonos: [{ amount_usd: 60_000, trm: 3_500 }],
      trmSimulada: 3_000, arancelPct: 5, ivaPct: 19,
    });
    expect(r.saldoUsd).toBe(0);
    expect(r.saldoCopSimulado).toBe(0);
  });

  it('IVA = 19% sobre (base aduana + arancel) con base mixta — fórmula de Nico', () => {
    const r = escenarioVigente({
      mercanciaUsd: 100_000, costs: undefined,
      abonos: [{ amount_usd: 50_000, trm: 4_000 }],
      trmSimulada: 3_000, arancelPct: 5, ivaPct: 19,
      cantidadKg: 20_000, // 5 USD/kg > piso → sin floor
    });
    const baseMixta = 50_000 * 4_000 + 50_000 * 3_000;
    const arancel = baseMixta * 0.05;
    const iva = (baseMixta + arancel) * 0.19;
    expect(r.breakdown.arancelCop).toBeCloseTo(arancel, 0);
    expect(r.breakdown.ivaCop).toBeCloseTo(iva, 0);
  });

  it('con liquidación real cargada, los impuestos pendientes son 0', () => {
    const r = escenarioVigente({
      mercanciaUsd: 100_000,
      costs: [
        { tipo: 'arancel', monto: 15_000_000, moneda: 'COP', trm: null },
        { tipo: 'iva_importacion', monto: 60_000_000, moneda: 'COP', trm: null },
      ] as never[],
      abonos: [{ amount_usd: 100_000, trm: 3_500 }],
      trmSimulada: 3_000, arancelPct: 5, ivaPct: 19,
    });
    expect(r.breakdown.usaArancelReal).toBe(true);
    expect(r.breakdown.usaIvaReal).toBe(true);
    expect(r.impuestosPendientesCop).toBe(0);
  });

  it('GUARDARRAÍL: el resultado sobrevive el round-trip JSON del cache', () => {
    const r = escenarioVigente({
      mercanciaUsd: 125_028, costs: COSTS,
      abonos: [{ amount_usd: 40_000, trm: 3_800 }],
      trmSimulada: 3_057, arancelPct: 5, ivaPct: 19, cantidadKg: 28_850,
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
