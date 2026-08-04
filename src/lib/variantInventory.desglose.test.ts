/**
 * Regresión del 2026-08-04: el teórico mostraba ~3.000 unidades de más.
 * Causa: el ancla del conteo guardaba la fecha del CLICK de confirmar y la
 * ventana comparaba `created_at` (digitación) en vez de la fecha del hecho —
 * las remisiones despachadas después del conteo pero cargadas antes del click
 * quedaban censuradas y nunca descontaban.
 */

import { describe, it, expect } from 'vitest';
import { computeVariantDesglose, movInstante, type VariantMovLite } from './variantInventory';

const salida = (fecha: string, qty: number, created_at: string): VariantMovLite => ({
  movement_type: 'salida', quantity: qty, source_type: 'remision', fecha, created_at,
});
const entrada = (fecha: string, qty: number): VariantMovLite => ({
  movement_type: 'entrada', quantity: qty, source_type: 'import', fecha, created_at: `${fecha}T10:00:00Z`,
});

describe('computeVariantDesglose — ventana del conteo', () => {
  // Conteo del 28/07 (ancla = cierre de ese día), confirmado el 04/08.
  const v = { stock_inicial: 1000, stock_inicial_date: '2026-07-28T23:59:59.999Z' };

  it('descuenta las remisiones POSTERIORES al conteo aunque se hayan digitado antes del click', () => {
    const d = computeVariantDesglose(v, [
      salida('2026-07-29', 500, '2026-07-29T09:00:00Z'),  // digitada el mismo día
      salida('2026-07-30', 300, '2026-07-30T09:00:00Z'),
      salida('2026-07-31', 200, '2026-07-31T09:00:00Z'),
    ]);
    expect(d.remisiones).toBe(1000);
    expect(d.teorico).toBe(0);
  });

  it('descuenta una remisión posterior al conteo digitada con retraso', () => {
    const d = computeVariantDesglose(v, [salida('2026-07-29', 500, '2026-08-03T18:00:00Z')]);
    expect(d.remisiones).toBe(500);
    expect(d.teorico).toBe(500);
  });

  it('NO vuelve a descontar lo que salió el día del conteo o antes (ya lo vio el conteo)', () => {
    const d = computeVariantDesglose(v, [
      salida('2026-07-28', 400, '2026-07-28T09:00:00Z'),
      salida('2026-07-20', 100, '2026-08-03T18:00:00Z'), // vieja, digitada tarde
    ]);
    expect(d.remisiones).toBe(0);
    expect(d.teorico).toBe(1000);
  });

  it('suma contenedores posteriores y resta remisiones sobre el mismo ancla', () => {
    const d = computeVariantDesglose(v, [
      entrada('2026-08-01', 2000),
      salida('2026-08-02', 300, '2026-08-02T09:00:00Z'),
    ]);
    expect(d).toMatchObject({ ancla: 1000, contenedor: 2000, remisiones: 300, teorico: 2700 });
  });

  it('un ajuste posterior re-ancla y borra lo anterior', () => {
    const d = computeVariantDesglose(v, [
      salida('2026-07-29', 500, '2026-07-29T09:00:00Z'),
      { movement_type: 'ajuste', quantity: 800, source_type: 'cierre_inventario', fecha: '2026-08-01', created_at: '2026-08-01T23:59:59.999Z' },
      salida('2026-08-02', 50, '2026-08-02T09:00:00Z'),
    ]);
    expect(d.ancla).toBe(800);
    expect(d.remisiones).toBe(50);
    expect(d.teorico).toBe(750);
  });

  it('filas viejas sin fecha caen al created_at (no explotan)', () => {
    const d = computeVariantDesglose(v, [
      { movement_type: 'salida', quantity: 70, source_type: 'remision', fecha: null, created_at: '2026-07-31T09:00:00Z' },
    ]);
    expect(d.remisiones).toBe(70);
  });
});

describe('movInstante', () => {
  it('como ancla cierra el día, como movimiento lo abre', () => {
    const m = salida('2026-07-28', 1, '2026-08-04T10:00:00Z');
    expect(movInstante(m, true)).toBe('2026-07-28T23:59:59.999Z');
    expect(movInstante(m, false)).toBe('2026-07-28T00:00:00.000Z');
  });
});
