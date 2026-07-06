import { describe, it, expect } from 'vitest';
import { computeImportBreakdown, sumImportCosts } from './importCosting';

describe('computeImportBreakdown', () => {
  it('estima arancel e IVA por % cuando no hay costo real cargado', () => {
    const bd = computeImportBreakdown({
      mercanciaUsd: 50000,
      costs: [
        { tipo: 'flete', monto: 2000, moneda: 'USD' },
        { tipo: 'seguro', monto: 500, moneda: 'USD' },
      ],
      trm: 4000,
      arancelPct: 5,
      ivaPct: 19,
    });
    expect(bd.cifUsd).toBe(52500);
    expect(bd.cifCop).toBe(210_000_000);
    expect(bd.usaArancelReal).toBe(false);
    expect(bd.arancelCop).toBe(10_500_000); // 5% del CIF
    expect(bd.usaIvaReal).toBe(false);
    expect(bd.ivaCop).toBe(41_895_000); // 19% de (CIF + arancel)
    expect(bd.totalImportacionCop).toBe(262_395_000);
  });

  it('el arancel/IVA real cargado manda sobre el estimado', () => {
    const bd = computeImportBreakdown({
      mercanciaUsd: 50000,
      costs: [
        { tipo: 'arancel', monto: 9_000_000, moneda: 'COP' },
        { tipo: 'iva_importacion', monto: 40_000_000, moneda: 'COP' },
        { tipo: 'nacionalizacion', monto: 3_000_000, moneda: 'COP' },
      ],
      trm: 4000,
      arancelPct: 5,
      ivaPct: 19,
    });
    expect(bd.usaArancelReal).toBe(true);
    expect(bd.arancelCop).toBe(9_000_000);
    expect(bd.usaIvaReal).toBe(true);
    expect(bd.ivaCop).toBe(40_000_000);
    expect(bd.otrosCop).toBe(3_000_000);
    expect(bd.totalImportacionCop).toBe(200_000_000 + 9_000_000 + 40_000_000 + 3_000_000);
  });

  it('sin TRM no hay pesos (queda null, no 0)', () => {
    const bd = computeImportBreakdown({ mercanciaUsd: 50000, costs: [], trm: null, arancelPct: 5, ivaPct: 19 });
    expect(bd.cifUsd).toBe(50000);
    expect(bd.cifCop).toBeNull();
    expect(bd.totalImportacionCop).toBeNull();
  });
});

describe('sumImportCosts', () => {
  it('separa por moneda y filtra por tipo', () => {
    const costs = [
      { tipo: 'flete', monto: 2000, moneda: 'USD' as const },
      { tipo: 'flete', monto: 1_500_000, moneda: 'COP' as const },
      { tipo: 'seguro', monto: 300, moneda: 'USD' as const },
    ];
    expect(sumImportCosts(costs, 'flete')).toEqual({ usd: 2000, cop: 1_500_000 });
    expect(sumImportCosts(costs, 'arancel')).toEqual({ usd: 0, cop: 0 });
  });
});
