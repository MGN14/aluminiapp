import { describe, it, expect } from 'vitest';
import { rankAluminumReferencesByUnits, type SoldItemLine } from './topReferences';

function line(p: Partial<SoldItemLine> & { reference: string | null; quantity: number }): SoldItemLine {
  return { description: null, line_base: 0, ...p };
}

// Referencias reales de la maestra (datos de producción, sep 2026).
const MAESTRA = ['GL4102-5', 'A059-5', 'SA325-5', '38X38-3'];

describe('rankAluminumReferencesByUnits', () => {
  it('la tornillería y el vidrio NO entran al ranking aunque tengan más unidades', () => {
    const { top } = rankAluminumReferencesByUnits([
      line({ reference: 'TOR8*1/2', quantity: 19900 }),   // tornillos: 19.900 en una línea
      line({ reference: 'CLARO*4', quantity: 3089.55 }),  // vidrio en m²
      line({ reference: 'GL4102-5', quantity: 163 }),
    ], MAESTRA);
    expect(top.map((r) => r.reference)).toEqual(['GL4102-5']);
  });

  it('ordena por unidades, no por importe (ese es el otro card)', () => {
    const { top } = rankAluminumReferencesByUnits([
      line({ reference: 'A059-5', quantity: 100, line_base: 50_000_000 }),
      line({ reference: 'GL4102-5', quantity: 300, line_base: 1_000_000 }),
    ], MAESTRA);
    expect(top[0].reference).toBe('GL4102-5');
    expect(top[0].unidades).toBe(300);
  });

  it('suma la misma referencia escrita distinto: 38*38-3 y 38X38-3 son una sola fila', () => {
    const { top, referenciasDistintas } = rankAluminumReferencesByUnits([
      line({ reference: '38*38-3', quantity: 40 }),
      line({ reference: '38X38-3', quantity: 60 }),
    ], MAESTRA);
    expect(referenciasDistintas).toBe(1);
    expect(top[0].unidades).toBe(100);
    expect(top[0].lineas).toBe(2);
  });

  it('desempata por importe cuando las unidades empatan', () => {
    const { top } = rankAluminumReferencesByUnits([
      line({ reference: 'A059-5', quantity: 50, line_base: 1_000 }),
      line({ reference: 'SA325-5', quantity: 50, line_base: 9_000 }),
    ], MAESTRA);
    expect(top[0].reference).toBe('SA325-5');
  });

  it('ítems sin referencia (facturas de PDF viejas) se ignoran, no rompen', () => {
    const { top, totalUnidades } = rankAluminumReferencesByUnits([
      line({ reference: null, description: 'Perfil de aluminio', quantity: 500 }),
      line({ reference: '', quantity: 200 }),
      line({ reference: 'A059-5', quantity: 10 }),
    ], MAESTRA);
    expect(top).toHaveLength(1);
    expect(totalUnidades).toBe(10);
  });

  it('totalUnidades cuenta TODO el aluminio del período, no solo el top 3 (para el %)', () => {
    const { top, totalUnidades } = rankAluminumReferencesByUnits([
      line({ reference: 'GL4102-5', quantity: 100 }),
      line({ reference: 'A059-5', quantity: 50 }),
      line({ reference: 'SA325-5', quantity: 30 }),
      line({ reference: '38X38-3', quantity: 20 }),
    ], MAESTRA, 3);
    expect(top).toHaveLength(3);
    expect(totalUnidades).toBe(200);
  });

  it('una devolución dentro de la factura (cantidad negativa) NETEA las unidades', () => {
    const { top } = rankAluminumReferencesByUnits([
      line({ reference: 'GL4102-5', quantity: 100 }),
      line({ reference: 'GL4102-5', quantity: -30 }),
    ], MAESTRA);
    expect(top[0].unidades).toBe(70);
  });

  it('maestra vacía → ranking vacío (nunca inventa datos)', () => {
    const { top, totalUnidades } = rankAluminumReferencesByUnits(
      [line({ reference: 'GL4102-5', quantity: 100 })], [],
    );
    expect(top).toHaveLength(0);
    expect(totalUnidades).toBe(0);
  });

  it('el resultado sobrevive el round-trip JSON del cache persistido', () => {
    const r = rankAluminumReferencesByUnits([line({ reference: 'A059-5', quantity: 5 })], MAESTRA);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
