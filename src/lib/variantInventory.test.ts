/**
 * LA fórmula única (decisión de Nico, 2026-08-04):
 *   stock = inicial + contenedor − remisiones, con UNA fecha de corte global
 *   (F0), cortando por la fecha del HECHO — nunca por created_at.
 */

import { describe, it, expect } from 'vitest';
import { computeVariantDesglose, type VariantMovLite } from './variantInventory';

const mov = (p: Partial<VariantMovLite>): VariantMovLite => ({
  movement_type: 'salida', quantity: 0, source_type: 'remision',
  created_at: '2026-08-04T10:00:00Z', fecha: null, ...p,
});
const salida = (fecha: string, qty: number, created_at = `${fecha}T09:00:00Z`) =>
  mov({ fecha, quantity: qty, created_at });
const contenedor = (fecha: string, qty: number) =>
  mov({ fecha, quantity: qty, movement_type: 'entrada', source_type: 'import' });

const V = { stock_inicial: 100, stock_inicial_date: '2026-07-01T00:00:00Z' };

describe('computeVariantDesglose — el ejemplo que decidió Nico', () => {
  it('inicial 100 (corte 01/07) − remisión 30 del 10/07 + contenedor 500 del 15/07 = 570', () => {
    const d = computeVariantDesglose(V, [
      salida('2026-07-10', 30),
      contenedor('2026-07-15', 500),
    ], '2026-07-01');
    expect(d).toEqual({ ancla: 100, contenedor: 500, remisiones: 30, teorico: 570 });
  });
});

describe('computeVariantDesglose — la ventana es F0, no la digitación', () => {
  it('descuenta una remisión posterior a F0 aunque se digitó semanas después', () => {
    const d = computeVariantDesglose(V, [salida('2026-07-29', 50, '2026-08-03T18:00:00Z')], '2026-07-01');
    expect(d.remisiones).toBe(50);
    expect(d.teorico).toBe(50);
  });

  it('NO descuenta una remisión anterior a F0 aunque se digitó después (ya está en el inicial)', () => {
    const d = computeVariantDesglose(V, [salida('2026-06-15', 50, '2026-08-03T18:00:00Z')], '2026-07-01');
    expect(d.remisiones).toBe(0);
    expect(d.teorico).toBe(100);
  });

  it('la MISMA historia da el MISMO stock sin importar cuándo se tecleó (estabilidad)', () => {
    const temprano = [salida('2026-07-10', 30, '2026-07-10T08:00:00Z'), contenedor('2026-07-15', 500)];
    const tarde = [salida('2026-07-10', 30, '2026-08-04T23:00:00Z'), contenedor('2026-07-15', 500)];
    expect(computeVariantDesglose(V, temprano, '2026-07-01').teorico)
      .toBe(computeVariantDesglose(V, tarde, '2026-07-01').teorico);
  });

  it('caso A059 (2026-08-01): conteo 142 − remisión 460 + contenedor 660 = 342', () => {
    const d = computeVariantDesglose(
      { stock_inicial: 142, stock_inicial_date: '2026-07-01T00:00:00Z' },
      [salida('2026-07-10', 460), contenedor('2026-07-20', 660)],
      '2026-07-01',
    );
    expect(d.teorico).toBe(342);
  });

  it('remisiones de compra suman (restan del neto)', () => {
    const d = computeVariantDesglose(V, [
      salida('2026-07-05', 20),
      mov({ fecha: '2026-07-06', quantity: 8, movement_type: 'entrada', source_type: 'remision' }),
    ], '2026-07-01');
    expect(d.remisiones).toBe(12);
    expect(d.teorico).toBe(88);
  });

  it('filas viejas sin fecha caen al día de created_at (no explotan)', () => {
    const d = computeVariantDesglose(V, [
      mov({ fecha: null, quantity: 70, created_at: '2026-07-31T09:00:00Z' }),
    ], '2026-07-01');
    expect(d.remisiones).toBe(70);
  });
});

describe('computeVariantDesglose — el inicial (fotos)', () => {
  it('la foto más reciente manda sobre stock_inicial', () => {
    const d = computeVariantDesglose(V, [
      mov({ fecha: '2026-06-20', quantity: 250, movement_type: 'inicial', source_type: 'inicial' }),
      salida('2026-07-10', 50),
    ], '2026-07-01');
    expect(d.ancla).toBe(250);
    expect(d.teorico).toBe(200);
  });

  it('un ajuste manual POSTERIOR a F0 mueve el arranque de esa referencia (la corrección no se deshace)', () => {
    const d = computeVariantDesglose(V, [
      salida('2026-07-10', 30),                              // absorbida por el ajuste
      mov({ fecha: '2026-07-20', quantity: 80, movement_type: 'ajuste', source_type: 'manual' }),
      salida('2026-07-25', 5),
    ], '2026-07-01');
    expect(d.ancla).toBe(80);
    expect(d.remisiones).toBe(5);
    expect(d.teorico).toBe(75);
  });

  it('sin movimientos, el stock es el inicial', () => {
    expect(computeVariantDesglose(V, [], '2026-07-01').teorico).toBe(100);
  });

  it('con dos fotos gana la más nueva', () => {
    const d = computeVariantDesglose(V, [
      mov({ fecha: '2026-06-10', quantity: 999, movement_type: 'inicial', source_type: 'inicial' }),
      mov({ fecha: '2026-06-25', quantity: 40, movement_type: 'inicial', source_type: 'inicial' }),
    ], '2026-07-01');
    expect(d.ancla).toBe(40);
  });
});
