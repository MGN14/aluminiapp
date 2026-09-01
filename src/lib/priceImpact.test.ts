import { describe, it, expect } from 'vitest';
import { computePriceImpact, MARGEN_OBJETIVO, type RefPrecio } from './priceImpact';

const ref = (o: Partial<RefPrecio>): RefPrecio => ({
  familia: 'GL4102', reference: 'GL4102', descripcion: 'Ángulo', cantidad: 100,
  landedUnit: 5000, precioLista: 7000, ...o,
});

describe('computePriceImpact', () => {
  it('margen MAYORISTA es sobre el precio, no sobre el costo', () => {
    // Lista = costo × 1,18 sin IVA → margen 0,18/1,18 = 15,25%
    const r = computePriceImpact([ref({ landedUnit: 1000, precioLista: 1180 })], { ivaIncluido: false });
    expect(r.refs[0].margen).toBeCloseTo(0.1525, 3);
    expect(r.margenPonderado).toBeCloseTo(0.1525, 3);
  });

  it('descuenta el IVA del precio de lista cuando viene incluido', () => {
    const conIva = computePriceImpact([ref({ landedUnit: 1000, precioLista: 1404.2 })], { ivaIncluido: true, ivaPct: 19 });
    // 1404,2 / 1,19 = 1180 → mismo margen que el caso sin IVA
    expect(conIva.refs[0].precioSinIva).toBeCloseTo(1180, 0);
    expect(conIva.refs[0].margen).toBeCloseTo(0.1525, 3);
  });

  it('detecta refs en pérdida y en riesgo', () => {
    const r = computePriceImpact([
      ref({ reference: 'PERDIDA', landedUnit: 1200, precioLista: 1000 }),
      ref({ reference: 'RIESGO', landedUnit: 960, precioLista: 1000 }),   // margen 4%
      ref({ reference: 'SANA', landedUnit: 700, precioLista: 1000 }),      // margen 30%
    ], { ivaIncluido: false });
    expect(r.enPerdida.map((x) => x.reference)).toEqual(['PERDIDA']);
    expect(r.enRiesgo.map((x) => x.reference)).toEqual(['RIESGO']);
  });

  it('calcula el precio necesario para volver al margen objetivo', () => {
    const r = computePriceImpact([ref({ landedUnit: 1000, precioLista: 1050 })], { ivaIncluido: false });
    const necesario = 1000 / (1 - MARGEN_OBJETIVO);
    expect(r.refs[0].precioNecesario).toBeCloseTo(necesario, 0);
    expect(r.refs[0].ajustePct).toBeCloseTo((necesario / 1050 - 1) * 100, 1);
  });

  it('si ya está por encima del objetivo, no pide ajuste', () => {
    const r = computePriceImpact([ref({ landedUnit: 500, precioLista: 1000 })], { ivaIncluido: false });
    expect(r.refs[0].ajustePct).toBeNull();
    expect(r.ajusteNecesarioPct).toBeNull();
  });

  it('las refs sin precio de lista no ensucian el margen ponderado', () => {
    const r = computePriceImpact([
      ref({ landedUnit: 1000, precioLista: 1180 }),
      ref({ reference: 'SIN', landedUnit: 9999, precioLista: null }),
    ], { ivaIncluido: false });
    expect(r.conPrecio).toBe(1);
    expect(r.sinPrecio).toBe(1);
    expect(r.margenPonderado).toBeCloseTo(0.1525, 3);
  });

  it('pondera por cantidad: la ref grande manda sobre la chica', () => {
    const r = computePriceImpact([
      ref({ reference: 'GRANDE', cantidad: 1000, landedUnit: 900, precioLista: 1000 }), // 10%
      ref({ reference: 'CHICA', cantidad: 1, landedUnit: 100, precioLista: 1000 }),      // 90%
    ], { ivaIncluido: false });
    expect(r.margenPonderado!).toBeGreaterThan(0.10);
    expect(r.margenPonderado!).toBeLessThan(0.15);
  });

  it('GUARDARRAÍL: sobrevive el round-trip JSON del cache', () => {
    const r = computePriceImpact([ref({})], { ivaIncluido: true });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
