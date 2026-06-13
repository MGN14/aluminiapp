import { describe, it, expect } from 'vitest';
import { computeReorder, reorderTotals } from './reorder';

const base = { unit: 'kg', cost_per_unit: 100 };

describe('computeReorder', () => {
  it('ignora productos sin punto de reorden (min_stock 0) y los que están sobre el mínimo', () => {
    const r = computeReorder([
      { ...base, reference: 'A', name: 'A', stock_system: 5, min_stock: 0 },   // sin mínimo
      { ...base, reference: 'B', name: 'B', stock_system: 100, min_stock: 20 }, // sobre mínimo
    ]);
    expect(r).toHaveLength(0);
  });

  it('clasifica quiebre / crítico / bajo', () => {
    const r = computeReorder([
      { ...base, reference: 'Q', name: 'Q', stock_system: 0, min_stock: 10 },
      { ...base, reference: 'C', name: 'C', stock_system: 4, min_stock: 10 },
      { ...base, reference: 'B', name: 'B', stock_system: 10, min_stock: 10 },
    ]);
    expect(r.map((i) => i.nivel)).toEqual(['quiebre', 'critico', 'bajo']); // ordenado por criticidad
  });

  it('sugiere reponer hasta 2× el mínimo y calcula costo', () => {
    const r = computeReorder([{ ...base, reference: 'X', name: 'X', stock_system: 3, min_stock: 10 }]);
    // objetivo 20, stock 3 → sugerido 17; costo 17 × 100 = 1700; faltante 7
    expect(r[0].cantidadSugerida).toBe(17);
    expect(r[0].faltante).toBe(7);
    expect(r[0].costoReposicion).toBe(1700);
  });

  it('respeta el targetFactor', () => {
    const r = computeReorder([{ ...base, reference: 'X', name: 'X', stock_system: 0, min_stock: 10 }], 3);
    expect(r[0].cantidadSugerida).toBe(30); // 3× mínimo
  });

  it('totales: conteo, quiebres y costo total', () => {
    const items = computeReorder([
      { ...base, reference: 'Q', name: 'Q', stock_system: 0, min_stock: 10 },   // sugerido 20 → 2000
      { ...base, reference: 'C', name: 'C', stock_system: 5, min_stock: 10 },   // sugerido 15 → 1500
    ]);
    const t = reorderTotals(items);
    expect(t.count).toBe(2);
    expect(t.quiebres).toBe(1);
    expect(t.costoTotal).toBe(3500);
  });
});
