import { describe, it, expect } from 'vitest';
import { computeLandedCost, type LandedItemInput, type LandedCostInput } from './landedCost';

const items: LandedItemInput[] = [
  { id: 'a', reference: 'REF-1', cantidad: 100, unidad: 'kg', peso_kg: 1000, fob_total_usd: 3000 },
  { id: 'b', reference: 'REF-2', cantidad: 50, unidad: 'kg', peso_kg: 1000, fob_total_usd: 1000 },
];

describe('computeLandedCost', () => {
  it('convierte FOB a COP con la TRM ponderada', () => {
    const r = computeLandedCost(items, [], 4000);
    expect(r.totals.fob_total_usd).toBe(4000);
    expect(r.totals.fob_total_cop).toBe(16_000_000); // 4000 USD * 4000
    expect(r.items[0].fob_total_cop).toBe(12_000_000); // 3000 * 4000
  });

  it('prorratea un costo por PESO en partes iguales cuando los pesos son iguales', () => {
    const costs: LandedCostInput[] = [
      { id: 'c1', tipo: 'flete', monto: 1000, moneda: 'USD', trm: null, base_asignacion: 'peso' },
    ];
    const r = computeLandedCost(items, costs, 4000);
    // Flete 1000 USD * 4000 = 4.000.000 COP, repartido 50/50 por peso (1000kg c/u)
    expect(r.items[0].costos_asignados_cop).toBe(2_000_000);
    expect(r.items[1].costos_asignados_cop).toBe(2_000_000);
  });

  it('prorratea un costo por VALOR FOB proporcional al FOB de cada ítem', () => {
    const costs: LandedCostInput[] = [
      // arancel 400 COP-equiv via USD: 100 USD * 4000 = 400.000 COP
      { id: 'c1', tipo: 'arancel', monto: 100, moneda: 'USD', trm: null, base_asignacion: 'valor' },
    ];
    const r = computeLandedCost(items, costs, 4000);
    // REF-1 tiene 75% del FOB (3000/4000), REF-2 el 25%.
    expect(r.items[0].costos_asignados_cop).toBe(300_000);
    expect(r.items[1].costos_asignados_cop).toBe(100_000);
  });

  it('usa la TRM propia del costo si la trae (diferencia en cambio por línea)', () => {
    const costs: LandedCostInput[] = [
      { id: 'c1', tipo: 'flete', monto: 100, moneda: 'USD', trm: 5000, base_asignacion: 'peso' },
    ];
    const r = computeLandedCost(items, costs, 4000);
    // 100 USD * 5000 (TRM propia) = 500.000, repartido 50/50
    expect(r.items[0].costos_asignados_cop).toBe(250_000);
  });

  it('respeta costos en COP sin tocar la TRM', () => {
    const costs: LandedCostInput[] = [
      { id: 'c1', tipo: 'nacionalizacion', monto: 800_000, moneda: 'COP', trm: null, base_asignacion: 'peso' },
    ];
    const r = computeLandedCost(items, costs, 4000);
    expect(r.totals.costos_total_cop).toBe(800_000);
    expect(r.items[0].costos_asignados_cop).toBe(400_000);
  });

  it('calcula costo unitario y por kg, y la composición FOB vs importación', () => {
    const costs: LandedCostInput[] = [
      { id: 'c1', tipo: 'flete', monto: 1000, moneda: 'USD', trm: null, base_asignacion: 'peso' },
    ];
    const r = computeLandedCost(items, costs, 4000);
    // REF-1: FOB 12M + flete 2M = 14M landed; /100 unidades = 140.000/u; /1000kg = 14.000/kg
    expect(r.items[0].landed_total_cop).toBe(14_000_000);
    expect(r.items[0].landed_unit_cop).toBe(140_000);
    expect(r.items[0].landed_por_kg_cop).toBe(14_000);
    // Composición: FOB 16M de 20M total = 80%
    expect(r.totals.landed_total_cop).toBe(20_000_000);
    expect(r.totals.pct_fob).toBe(80);
    expect(r.totals.pct_costos).toBe(20);
  });

  it('sin TRM (0) deja los montos USD en 0 COP y marca trmUsada=0', () => {
    const r = computeLandedCost(items, [], null);
    expect(r.trmUsada).toBe(0);
    expect(r.totals.fob_total_cop).toBe(0);
  });

  it('hace fallback cuando la base elegida suma 0, sin perder el costo', () => {
    const noWeight: LandedItemInput[] = [
      { id: 'a', reference: 'X', cantidad: 6, unidad: 'u', peso_kg: null, fob_total_usd: 100 },
      { id: 'b', reference: 'Y', cantidad: 4, unidad: 'u', peso_kg: null, fob_total_usd: 100 },
    ];
    const costs: LandedCostInput[] = [
      // base 'peso' pero ningún ítem tiene peso → fallback a 'cantidad' (6/4)
      { id: 'c1', tipo: 'flete', monto: 100, moneda: 'USD', trm: null, base_asignacion: 'peso' },
    ];
    const r = computeLandedCost(noWeight, costs, 4000);
    expect(r.fallbackCostIds).toContain('c1');
    // 100 USD * 4000 = 400.000 COP repartido por cantidad: 6/10 y 4/10
    expect(r.items[0].costos_asignados_cop).toBe(240_000);
    expect(r.items[1].costos_asignados_cop).toBe(160_000);
    // Nada se evapora: los totales cuadran.
    expect(r.totals.costos_total_cop).toBe(400_000);
  });

  it('reconcilia: FOB + Importación = Landed exacto en los totales', () => {
    const costs: LandedCostInput[] = [
      { id: 'c1', tipo: 'flete', monto: 1000, moneda: 'USD', trm: null, base_asignacion: 'peso' },
      { id: 'c2', tipo: 'arancel', monto: 100, moneda: 'USD', trm: null, base_asignacion: 'valor' },
      { id: 'c3', tipo: 'nacionalizacion', monto: 500_000, moneda: 'COP', trm: null, base_asignacion: 'cantidad' },
    ];
    const r = computeLandedCost(items, costs, 4000);
    expect(r.totals.fob_total_cop + r.totals.costos_total_cop).toBe(r.totals.landed_total_cop);
    const sumItems = r.items.reduce((s, it) => s + it.landed_total_cop, 0);
    expect(Math.round(sumItems)).toBe(r.totals.landed_total_cop);
  });
});
