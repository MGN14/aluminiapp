import { describe, it, expect } from 'vitest';
import { driversDelta, type LadoDriver } from './importDrivers';

const MOLDE: LadoDriver = {
  totalCop: 507_922_913, smmUsdTon: 3_585, tons: 28.4374, trm: 3_506, fleteUsd: 5_800, usdTotal: 131_014,
};
const VIGENTE: LadoDriver = {
  totalCop: 465_284_680, smmUsdTon: 3_520, tons: 28.848, trm: 3_183, fleteUsd: 5_700, usdTotal: 130_838,
};

describe('driversDelta', () => {
  it('los drivers SIEMPRE suman exacto la diferencia total', () => {
    const r = driversDelta(MOLDE, VIGENTE);
    const suma = r.drivers.reduce((s, d) => s + d.cop, 0);
    expect(suma).toBeCloseTo(r.deltaTotalCop, 6);
    expect(r.deltaTotalCop).toBeCloseTo(465_284_680 - 507_922_913, 6);
  });

  it('con los números del HTML de Nico: el dólar es el driver grande y a favor', () => {
    const r = driversDelta(MOLDE, VIGENTE);
    const trm = r.drivers.find((d) => d.key === 'trm')!;
    const smm = r.drivers.find((d) => d.key === 'smm')!;
    const peso = r.drivers.find((d) => d.key === 'peso')!;
    expect(trm.cop).toBeLessThan(-40_000_000);   // ~−$42M
    expect(smm.cop).toBeLessThan(0);              // aluminio ayudó
    expect(peso.cop).toBeGreaterThan(0);          // despacharon más kilos
  });

  it('lados idénticos → todos los drivers en 0', () => {
    const r = driversDelta(MOLDE, MOLDE);
    expect(r.deltaTotalCop).toBe(0);
    for (const d of r.drivers) expect(d.cop).toBeCloseTo(0, 6);
  });

  it('faltan datos de un driver → ese driver no aparece pero la suma sigue exacta', () => {
    const r = driversDelta({ ...MOLDE, fleteUsd: null }, VIGENTE);
    expect(r.drivers.find((d) => d.key === 'flete')).toBeUndefined();
    const suma = r.drivers.reduce((s, d) => s + d.cop, 0);
    expect(suma).toBeCloseTo(r.deltaTotalCop, 6);
  });

  it('GUARDARRAÍL: sobrevive el round-trip JSON', () => {
    const r = driversDelta(MOLDE, VIGENTE);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
