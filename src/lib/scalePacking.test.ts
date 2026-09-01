import { describe, it, expect } from 'vitest';
import { scalePacking, totalesDe } from './scalePacking';
import { computeLandedCost } from './landedCost';
import type { LandedItemInput, LandedCostInput } from './landedCost';

const items: LandedItemInput[] = [
  { id: '1', reference: 'A', cantidad: 1000, unidad: 'und', peso_kg: 14200, fob_total_usd: 60000 },
  { id: '2', reference: 'B', cantidad: 985, unidad: 'und', peso_kg: 14200, fob_total_usd: 64000 },
];
// Flete prorrateado por PESO — la base que a Nico le importa.
const costs: LandedCostInput[] = [
  { id: 'c1', tipo: 'flete', monto: 5700, moneda: 'USD', trm: null, base_asignacion: 'peso' },
];

describe('scalePacking', () => {
  it('sin ajuste no toca nada', () => {
    const r = scalePacking(items, {});
    expect(r.escalado).toBe(false);
    expect(r.items).toBe(items);
  });

  it('escala cada dimensión con SU factor', () => {
    const base = totalesDe(items); // 124.000 USD · 28.400 kg · 1.985 und
    const r = scalePacking(items, { mercanciaUsd: 130_200, pesoKg: 28_800, unidades: 2_100 });
    expect(r.factores.valor).toBeCloseTo(130_200 / base.mercanciaUsd, 6);
    expect(r.factores.peso).toBeCloseTo(28_800 / base.pesoKg, 6);
    expect(r.factores.cantidad).toBeCloseTo(2_100 / base.unidades, 6);
    expect(r.efectivo.mercanciaUsd).toBeCloseTo(130_200, 4);
    expect(r.efectivo.pesoKg).toBeCloseTo(28_800, 4);
    expect(r.efectivo.unidades).toBeCloseTo(2_100, 4);
  });

  it('CASO NICO: más peso sin packing detallado → las unidades lo siguen', () => {
    const r = scalePacking(items, { pesoKg: 28_800 }); // de 28.400
    const f = 28_800 / 28_400;
    expect(r.factores.cantidad).toBeCloseTo(f, 6);
    expect(r.efectivo.unidades).toBeCloseTo(1_985 * f, 3);
  });

  it('derivarUnidades:false deja la cantidad quieta', () => {
    const r = scalePacking(items, { pesoKg: 28_800, derivarUnidades: false });
    expect(r.factores.cantidad).toBe(1);
    expect(r.efectivo.unidades).toBeCloseTo(1_985, 6);
  });

  it('EL PUNTO DE TODO: con más unidades, el flete UNITARIO baja', () => {
    const antes = computeLandedCost(items, costs, 4000);
    const escalado = scalePacking(items, { pesoKg: 28_800 }); // +1,4% peso y unidades
    const despues = computeLandedCost(escalado.items, costs, 4000);

    const unitAntes = antes.items[0].landed_unit_cop;
    const unitDespues = despues.items[0].landed_unit_cop;
    // El flete total no cambió (5.700 USD), pero se reparte entre más piezas.
    expect(unitDespues).toBeLessThan(unitAntes);
    // Y el costo TOTAL del pedido no se infla por el escalado del flete:
    // sube solo lo que sube la mercancía (que acá no se tocó).
    expect(despues.totals.costos_total_cop).toBeCloseTo(antes.totals.costos_total_cop, 2);
  });

  it('escalar el VALOR sube el arancel pero no el flete', () => {
    const costsMix: LandedCostInput[] = [
      ...costs,
      { id: 'c2', tipo: 'arancel', monto: 20_000_000, moneda: 'COP', trm: null, base_asignacion: 'valor' },
    ];
    const antes = computeLandedCost(items, costsMix, 4000);
    const r = scalePacking(items, { mercanciaUsd: 130_200 });
    const despues = computeLandedCost(r.items, costsMix, 4000);
    // El FOB en COP sube proporcionalmente...
    expect(despues.totals.fob_total_cop).toBeGreaterThan(antes.totals.fob_total_cop);
    // ...y los costos fijos siguen siendo los mismos en total.
    expect(despues.totals.costos_total_cop).toBeCloseTo(antes.totals.costos_total_cop, 2);
  });

  it('GUARDARRAÍL: sobrevive el round-trip JSON', () => {
    const r = scalePacking(items, { pesoKg: 28_800 });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
