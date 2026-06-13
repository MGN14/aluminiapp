import { describe, it, expect } from 'vitest';
import { computeProfitability, type SaleLine } from './profitability';

const cost = new Map<string, number>([['ref-1', 100], ['ref-2', 50]]);

const lines: SaleLine[] = [
  { reference: 'REF-1', quantity: 10, ingreso: 1500, clientKey: 'c1', clientName: 'Aluminios JH' },
  { reference: 'REF-2', quantity: 20, ingreso: 1400, clientKey: 'c1', clientName: 'Aluminios JH' },
  { reference: 'REF-1', quantity: 5, ingreso: 800, clientKey: 'c2', clientName: 'Vidrios SAS' },
];

describe('computeProfitability', () => {
  it('margen por referencia = ingreso − qty×costo', () => {
    const r = computeProfitability(lines, cost);
    const ref1 = r.byReference.find((x) => x.key === 'ref-1')!;
    // REF-1: qty 15, ingreso 2300, costo 15×100=1500, margen 800
    expect(ref1.cantidad).toBe(15);
    expect(ref1.ingreso).toBe(2300);
    expect(ref1.costo).toBe(1500);
    expect(ref1.margen).toBe(800);
    expect(ref1.margenPct).toBeCloseTo(34.78, 1);
  });

  it('agrupa por cliente', () => {
    const r = computeProfitability(lines, cost);
    const c1 = r.byClient.find((x) => x.key === 'c1')!;
    // c1: REF-1 10×150=1500 (costo 1000) + REF-2 1400 (costo 1000) = ingreso 2900, costo 2000, margen 900
    expect(c1.ingreso).toBe(2900);
    expect(c1.costo).toBe(2000);
    expect(c1.margen).toBe(900);
  });

  it('totales', () => {
    const r = computeProfitability(lines, cost);
    expect(r.totals.ingreso).toBe(3700);
    expect(r.totals.costo).toBe(2500); // REF-1 15×100=1500 + REF-2 20×50=1000
    expect(r.totals.margen).toBe(1200);
  });

  it('referencia sin costo en inventario → no costeable, no infla margen', () => {
    const r = computeProfitability(
      [{ reference: 'REF-X', quantity: 10, ingreso: 1000, clientKey: 'c1', clientName: 'X' }],
      cost,
    );
    const refX = r.byReference.find((x) => x.key === 'ref-x')!;
    expect(refX.costo).toBe(0);
    expect(refX.costoCompleto).toBe(false);
    expect(r.totals.refsSinCosto).toBe(1);
    // El costo total NO suma esta referencia (margen = ingreso, marcado incompleto)
    expect(r.totals.costo).toBe(0);
  });

  it('ordena por margen descendente', () => {
    const r = computeProfitability(lines, cost);
    for (let i = 1; i < r.byReference.length; i++) {
      expect(r.byReference[i - 1].margen).toBeGreaterThanOrEqual(r.byReference[i].margen);
    }
  });

  it('margenPct null si ingreso 0', () => {
    const r = computeProfitability(
      [{ reference: 'REF-1', quantity: 0, ingreso: 0, clientKey: 'c1', clientName: 'X' }],
      cost,
    );
    expect(r.byReference[0].margenPct).toBeNull();
  });
});
