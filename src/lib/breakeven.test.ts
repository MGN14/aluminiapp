import { describe, it, expect } from 'vitest';
import { computeBreakeven } from './breakeven';

describe('computeBreakeven', () => {
  it('caso base: ventas 100, CV 60, CF 30', () => {
    const r = computeBreakeven({ ventas: 100, costosVariables: 60, costosFijos: 30 });
    expect(r.margenContribucion).toBe(40);
    expect(r.ratioContribucionPct).toBe(40);
    expect(r.puntoEquilibrio).toBe(75);    // 30 / 0.40
    expect(r.utilidad).toBe(10);
    expect(r.excedenteVentas).toBe(25);    // 100 − 75
    expect(r.margenSeguridadPct).toBe(25); // 25/100
  });

  it('exactamente en el punto de equilibrio → utilidad 0', () => {
    const r = computeBreakeven({ ventas: 75, costosVariables: 45, costosFijos: 30 });
    // MC = 30, ratio 40%, PE = 75 = ventas
    expect(r.utilidad).toBe(0);
    expect(r.puntoEquilibrio).toBe(75);
    expect(r.margenSeguridadPct).toBe(0);
  });

  it('por debajo del PE → utilidad negativa y margen de seguridad negativo', () => {
    const r = computeBreakeven({ ventas: 50, costosVariables: 30, costosFijos: 30 });
    expect(r.utilidad).toBe(-10);          // MC 20 − 30
    expect(r.excedenteVentas).toBeLessThan(0);
    expect(r.margenSeguridadPct).toBeLessThan(0);
  });

  it('costos variables ≥ ventas → no hay punto de equilibrio', () => {
    const r = computeBreakeven({ ventas: 100, costosVariables: 110, costosFijos: 30 });
    expect(r.ratioContribucionPct).toBeLessThanOrEqual(0);
    expect(r.puntoEquilibrio).toBeNull();
    expect(r.margenSeguridadPct).toBeNull();
  });

  it('sin ventas → ratio y PE nulos', () => {
    const r = computeBreakeven({ ventas: 0, costosVariables: 0, costosFijos: 30 });
    expect(r.ratioContribucionPct).toBeNull();
    expect(r.puntoEquilibrio).toBeNull();
    expect(r.utilidad).toBe(-30);
  });
});
