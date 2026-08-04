/**
 * La fórmula única acordada con Nico (2026-08-04):
 *   stock = inicial + contenedor − remisiones, con UNA fecha de corte global,
 *   cortando siempre por la fecha del hecho (nunca por created_at).
 */

import { describe, it, expect } from 'vitest';
import {
  computeStockConCorte, detectarSinCruce, auditarMovimientos,
  type PreviewVariant, type PreviewMov, type PreviewData, type PreviewRemision,
} from './variantStockPreview';

const V: PreviewVariant = {
  id: 'v1', variant_reference: 'LIV-40-3', name: 'Liviano 40 negro',
  stock_hoy: 999, avg_cost: 10_000, stock_inicial: 100,
};

const mov = (p: Partial<PreviewMov>): PreviewMov => ({
  variant_id: 'v1', movement_type: 'salida', quantity: 0,
  source_type: 'remision', source_id: null, fecha: null,
  created_at: '2026-08-04T10:00:00Z', nota: null, ...p,
});

const salida = (fecha: string, qty: number, created_at = `${fecha}T09:00:00Z`) =>
  mov({ fecha, quantity: qty, created_at });
const contenedor = (fecha: string, qty: number) =>
  mov({ fecha, quantity: qty, movement_type: 'entrada', source_type: 'import' });

describe('computeStockConCorte — el ejemplo que decidió Nico', () => {
  // Inicial 100 (conteo del 01/07), remisión de 30 el 10/07, contenedor
  // +500 el 15/07. Nico: debe dar 570 (la del 10/07 SÍ descuenta).
  const movs = [salida('2026-07-10', 30), contenedor('2026-07-15', 500)];

  it('da 570: toda remisión posterior al corte descuenta', () => {
    const d = computeStockConCorte(V, movs, '2026-07-01');
    expect(d).toMatchObject({ inicial: 100, contenedor: 500, remisiones: 30, stock: 570 });
  });
});

describe('computeStockConCorte', () => {
  it('ignora lo anterior al corte: ya está dentro del inicial', () => {
    const d = computeStockConCorte(V, [salida('2026-06-20', 40), salida('2026-07-05', 10)], '2026-07-01');
    expect(d.remisiones).toBe(10);
    expect(d.stock).toBe(90);
  });

  it('descuenta una remisión posterior al corte aunque se haya digitado tarde', () => {
    const d = computeStockConCorte(V, [salida('2026-07-29', 50, '2026-08-03T18:00:00Z')], '2026-07-01');
    expect(d.remisiones).toBe(50);
    expect(d.stock).toBe(50);
  });

  it('NO descuenta una remisión vieja digitada tarde (el corte manda, no el tecleo)', () => {
    const d = computeStockConCorte(V, [salida('2026-06-15', 50, '2026-08-03T18:00:00Z')], '2026-07-01');
    expect(d.remisiones).toBe(0);
    expect(d.stock).toBe(100);
  });

  it('una remisión de COMPRA suma en vez de restar', () => {
    const d = computeStockConCorte(V, [
      salida('2026-07-10', 30),
      mov({ fecha: '2026-07-12', quantity: 80, movement_type: 'entrada', source_type: 'remision' }),
    ], '2026-07-01');
    expect(d.remisiones).toBe(-50);
    expect(d.stock).toBe(150);
  });

  it('el inicial sale de la foto más reciente ANTERIOR al corte', () => {
    const d = computeStockConCorte(V, [
      mov({ fecha: '2026-06-01', quantity: 700, movement_type: 'inicial', source_type: 'inicial' }),
      mov({ fecha: '2026-07-20', quantity: 250, movement_type: 'ajuste', source_type: 'cierre_inventario' }),
      salida('2026-07-25', 50),
    ], '2026-07-22');
    expect(d.inicial).toBe(250);
    expect(d.inicialOrigen).toContain('2026-07-20');
    expect(d.stock).toBe(200);
  });

  it('una foto POSTERIOR al corte no manda', () => {
    const d = computeStockConCorte(V, [
      mov({ fecha: '2026-08-01', quantity: 9999, movement_type: 'ajuste', source_type: 'cierre_inventario' }),
    ], '2026-07-01');
    expect(d.inicial).toBe(100); // el stock_inicial de la maestra
  });

  it('sin movimientos, el stock es el inicial', () => {
    expect(computeStockConCorte(V, [], '2026-07-01').stock).toBe(100);
  });

  it('mover el corte NO depende de created_at: dos corridas dan lo mismo', () => {
    const movs = [salida('2026-07-10', 30, '2026-07-10T08:00:00Z'), contenedor('2026-07-15', 500)];
    const movsTardios = [salida('2026-07-10', 30, '2026-08-04T23:00:00Z'), contenedor('2026-07-15', 500)];
    expect(computeStockConCorte(V, movs, '2026-07-01').stock)
      .toBe(computeStockConCorte(V, movsTardios, '2026-07-01').stock);
  });
});

describe('detectarSinCruce', () => {
  const rem = (p: Partial<PreviewRemision>): PreviewRemision => ({
    id: 'r1', number: 'REM-40', date: '2026-07-29', beneficiary: 'Todoalum',
    status: 'despachado', remision_type: 'venta', items: [], ...p,
  });
  const base: PreviewData = {
    variantes: [V], movs: [], aliases: new Map(), remisiones: [],
  };

  it('marca la línea cuya referencia no existe en el inventario', () => {
    const out = detectarSinCruce({ ...base, remisiones: [
      rem({ items: [{ reference: 'LIV-40-3', units: 10 }, { reference: 'LIV-40-5', units: 25 }] }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reference: 'LIV-40-5', units: 25, sugerencia: 'LIV-40-3' });
  });

  it('acepta la referencia escrita distinto (38*38 vs 38X38) vía forma canónica', () => {
    const v38 = { ...V, id: 'v2', variant_reference: '38X38-3' };
    const out = detectarSinCruce({ ...base, variantes: [v38],
      remisiones: [rem({ items: [{ reference: '38*38-3', units: 5 }] })] });
    expect(out).toHaveLength(0);
  });

  it('resuelve por alias confirmado', () => {
    const out = detectarSinCruce({ ...base,
      aliases: new Map([['viejo-40', 'LIV-40-3']]),
      remisiones: [rem({ items: [{ reference: 'VIEJO-40', units: 7 }] })] });
    expect(out).toHaveLength(0);
  });

  it('ignora las remisiones canceladas', () => {
    const out = detectarSinCruce({ ...base, remisiones: [
      rem({ status: 'cancelado', items: [{ reference: 'NO-EXISTE', units: 99 }] }),
    ] });
    expect(out).toHaveLength(0);
  });
});

describe('auditarMovimientos', () => {
  it('explica por qué cada movimiento cuenta o no', () => {
    const a = auditarMovimientos(
      [salida('2026-07-29', 120), salida('2026-06-20', 80)],
      '2026-07-01',
      new Map([]),
    );
    expect(a[0]).toMatchObject({ fecha: '2026-07-29', cuenta: true });
    expect(a[1]).toMatchObject({ fecha: '2026-06-20', cuenta: false });
    expect(a[1].porque).toContain('dentro del inicial');
  });
});
