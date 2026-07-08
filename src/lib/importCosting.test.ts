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

  // ── Piso FOB aduanero (4,13 USD/kg perfiles de aluminio) ──

  it('FOB bajo el piso → arancel/IVA sobre base mínima, CIF real intacto', () => {
    // 25 ton a 100.000 USD = 4,00 USD/kg (bajo el piso de 4,13)
    const bd = computeImportBreakdown({
      mercanciaUsd: 100_000,
      costs: [{ tipo: 'flete', monto: 2000, moneda: 'USD' }],
      trm: 4000,
      arancelPct: 5,
      ivaPct: 19,
      cantidadKg: 25_000,
    });
    expect(bd.fobUsdKg).toBe(4);
    expect(bd.pisoAplicado).toBe(true);
    // CIF real: lo que efectivamente se paga (102.000 USD × 4000)
    expect(bd.cifCop).toBe(408_000_000);
    // Base aduana: 4,13 × 25.000 = 103.250 USD de mercancía (+2.000 flete) × 4000
    expect(bd.cifAduanaCop).toBe(421_000_000);
    expect(bd.arancelCop).toBe(21_050_000); // 5% de la base aduana
    expect(bd.ivaCop).toBeCloseTo((421_000_000 + 21_050_000) * 0.19, 2);
    // Total = CIF REAL + impuestos (liquidados sobre base flooreada)
    expect(bd.totalImportacionCop).toBeCloseTo(408_000_000 + 21_050_000 + (421_000_000 + 21_050_000) * 0.19, 2);
  });

  it('FOB sobre el piso → sin cambios (base = valor factura)', () => {
    // 25 ton a 110.000 USD = 4,40 USD/kg (sobre el piso)
    const bd = computeImportBreakdown({
      mercanciaUsd: 110_000,
      costs: [],
      trm: 4000,
      arancelPct: 5,
      ivaPct: 19,
      cantidadKg: 25_000,
    });
    expect(bd.fobUsdKg).toBeCloseTo(4.4, 5);
    expect(bd.pisoAplicado).toBe(false);
    expect(bd.cifAduanaCop).toBe(bd.cifCop);
    expect(bd.arancelCop).toBe(440_000_000 * 0.05);
  });

  it('sin cantidad no se evalúa el piso (retrocompatible)', () => {
    const bd = computeImportBreakdown({ mercanciaUsd: 50_000, costs: [], trm: 4000, arancelPct: 5, ivaPct: 19 });
    expect(bd.fobUsdKg).toBeNull();
    expect(bd.pisoAplicado).toBe(false);
    expect(bd.arancelCop).toBe(200_000_000 * 0.05);
  });

  it('el arancel/IVA real cargado sigue mandando aunque el piso aplique', () => {
    const bd = computeImportBreakdown({
      mercanciaUsd: 100_000, // 4,00 USD/kg — bajo el piso
      costs: [
        { tipo: 'arancel', monto: 9_000_000, moneda: 'COP' },
        { tipo: 'iva_importacion', monto: 40_000_000, moneda: 'COP' },
      ],
      trm: 4000,
      arancelPct: 5,
      ivaPct: 19,
      cantidadKg: 25_000,
    });
    expect(bd.pisoAplicado).toBe(true);
    expect(bd.usaArancelReal).toBe(true);
    expect(bd.arancelCop).toBe(9_000_000); // el real de la declaración manda
    expect(bd.ivaCop).toBe(40_000_000);
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
