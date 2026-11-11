import { describe, it, expect } from 'vitest';
import {
  makeCanon, buildCargueLines, cargadoPorLinea, estadoLinea, evaluarConteo, serialYaContado,
  resumenCargue, ajustarItemsALoCargado, aplicarAjuste, notaCargue, ordenarPorUbicacion,
  type RemisionItemLite,
} from './despachoCargue';

const items: RemisionItemLite[] = [
  { id: 'i1', reference: 'GL4102-3', product_name: 'Marco ventana', units: 12 },
  { id: 'i2', reference: 'PC635-3', product_name: 'Perfil 635 negro', units: 6 },
  { id: 'i3', reference: 'pc635-3 ', product_name: null, units: 4 },
  { id: 'i4', reference: 'MN92', product_name: 'Cabezal', units: 20 },
];

describe('makeCanon', () => {
  it('normaliza mayúsculas y espacios', () => {
    const canon = makeCanon();
    expect(canon(' PC635-3 ')).toBe('pc635-3');
  });
  it('aplica alias confirmados (MN92 → MN-92) pero NO cruza colores', () => {
    const canon = makeCanon({ MN92: 'MN-92' });
    expect(canon('mn92')).toBe('mn-92');
    expect(canon('MN-92')).toBe('mn-92');
    expect(canon('PC635-2')).not.toBe(canon('PC635-3'));
  });
});

describe('buildCargueLines', () => {
  it('agrega una referencia repetida en varias líneas', () => {
    const lines = buildCargueLines(items, makeCanon());
    expect(lines).toHaveLength(3);
    const pc = lines.find((l) => l.key === 'pc635-3')!;
    expect(pc.pedido).toBe(10);
    expect(pc.itemIds).toEqual(['i2', 'i3']);
    expect(pc.name).toBe('Perfil 635 negro');
    expect(pc.reference).toBe('PC635-3');
  });
  it('ignora líneas sin referencia', () => {
    expect(buildCargueLines([{ id: 'x', reference: '  ', product_name: null, units: 3 }], makeCanon())).toEqual([]);
  });
});

describe('cargadoPorLinea / estadoLinea', () => {
  it('suma escaneos y ajustes negativos, nunca baja de 0', () => {
    const c = cargadoPorLinea([
      { id: 'a', reference: 'PC635-3', quantity: 4 },
      { id: 'b', reference: 'pc635-3', quantity: 4 },
      { id: 'c', reference: 'PC635-3', quantity: -1 },
      { id: 'd', reference: 'MN92', quantity: -3 },
    ], makeCanon());
    expect(c['pc635-3']).toBe(7);
    expect(c['mn92']).toBe(0);
  });
  it('clasifica pendiente / parcial / completo / sobrante', () => {
    expect(estadoLinea(10, 0)).toBe('pendiente');
    expect(estadoLinea(10, 8)).toBe('parcial');
    expect(estadoLinea(10, 10)).toBe('completo');
    expect(estadoLinea(10, 12)).toBe('sobrante');
  });
});

describe('evaluarConteo', () => {
  const lines = buildCargueLines(items, makeCanon());
  it('referencia que no va en el pedido = fuera', () => {
    expect(evaluarConteo(lines, {}, 'pc635-2', 6)).toEqual({ tipo: 'fuera' });
  });
  it('avisa al completar y al pasarse', () => {
    expect(evaluarConteo(lines, { 'pc635-3': 6 }, 'pc635-3', 4)).toEqual({ tipo: 'completo', nuevo: 10, pedido: 10 });
    expect(evaluarConteo(lines, { 'pc635-3': 8 }, 'pc635-3', 4)).toEqual({ tipo: 'sobrante', nuevo: 12, pedido: 10 });
    expect(evaluarConteo(lines, { 'pc635-3': 2 }, 'pc635-3', 4)).toEqual({ tipo: 'ok', nuevo: 6, pedido: 10 });
    expect(evaluarConteo(lines, { 'pc635-3': 6 }, 'pc635-3', -1)).toEqual({ tipo: 'faltante', nuevo: 5, pedido: 10 });
  });
});

describe('serialYaContado', () => {
  it('detecta el mismo paquete sin importar mayúsculas', () => {
    const ev = [{ id: 'a', reference: 'X', quantity: 6, serial: 'SA325B-0042' }];
    expect(serialYaContado(ev, 'sa325b-0042')).toBe(true);
    expect(serialYaContado(ev, 'SA325B-0043')).toBe(false);
    expect(serialYaContado(ev, null)).toBe(false);
  });
});

describe('resumenCargue', () => {
  const lines = buildCargueLines(items, makeCanon());
  it('cuadra cuando todo está completo', () => {
    const r = resumenCargue(lines, { 'gl4102-3': 12, 'pc635-3': 10, mn92: 20 });
    expect(r.cuadra).toBe(true);
    expect(r.totalPedido).toBe(42);
    expect(r.totalCargado).toBe(42);
    expect(r.refsCompletas).toBe(3);
  });
  it('lista faltantes y sobrantes', () => {
    const r = resumenCargue(lines, { 'gl4102-3': 12, 'pc635-3': 8, mn92: 22 });
    expect(r.cuadra).toBe(false);
    expect(r.faltantes).toEqual([{ key: 'pc635-3', reference: 'PC635-3', pedido: 10, cargado: 8, diferencia: 2 }]);
    expect(r.sobrantes).toEqual([{ key: 'mn92', reference: 'MN92', pedido: 20, cargado: 22, diferencia: 2 }]);
  });
});

describe('ajustarItemsALoCargado', () => {
  const canon = makeCanon();
  it('llena las líneas repetidas en orden y borra las que quedan en 0', () => {
    const plan = ajustarItemsALoCargado(items, canon, { 'gl4102-3': 12, 'pc635-3': 5, mn92: 0 });
    expect(plan.updates).toEqual([{ id: 'i2', units: 5 }]);
    expect(plan.deletes.sort()).toEqual(['i3', 'i4']);
  });
  it('lo que sobra va a la última línea de la referencia', () => {
    const plan = ajustarItemsALoCargado(items, canon, { 'gl4102-3': 14, 'pc635-3': 12, mn92: 20 });
    expect(plan.updates).toEqual([{ id: 'i1', units: 14 }, { id: 'i3', units: 6 }]);
    expect(plan.deletes).toEqual([]);
  });
  it('es idempotente: sobre ítems ya ajustados no cambia nada', () => {
    const cargado = { 'gl4102-3': 10, 'pc635-3': 7, mn92: 20 };
    const plan = ajustarItemsALoCargado(items, canon, cargado);
    const ajustados = aplicarAjuste(items, plan);
    expect(ajustarItemsALoCargado(ajustados, canon, cargado)).toEqual({ updates: [], deletes: [] });
    expect(ajustados.map((i) => [i.id, i.units])).toEqual([['i1', 10], ['i2', 6], ['i3', 1], ['i4', 20]]);
  });
});

describe('notaCargue', () => {
  it('deja por escrito qué faltó y que se ajustó', () => {
    const lines = buildCargueLines(items, makeCanon());
    const r = resumenCargue(lines, { 'gl4102-3': 12, 'pc635-3': 8, mn92: 20 });
    const nota = notaCargue(r, { operador: 'bodega@x.co', cuando: new Date(2026, 10, 11, 15, 42), ajustada: true });
    expect(nota).toBe('Cargue verificado en bodega el 11/11/2026 15:42 por bodega@x.co: 40 de 42 und. Faltó: PC635-3 ×2 (pedido 10, cargado 8). Remisión ajustada a lo cargado.');
  });
  it('si cuadra no habla de ajustes', () => {
    const lines = buildCargueLines(items, makeCanon());
    const r = resumenCargue(lines, { 'gl4102-3': 12, 'pc635-3': 10, mn92: 20 });
    expect(notaCargue(r, { operador: '', cuando: new Date(2026, 0, 2, 8, 5), ajustada: false }))
      .toBe('Cargue verificado en bodega el 02/01/2026 08:05: 42 de 42 und.');
  });
});

describe('ordenarPorUbicacion', () => {
  it('ordena por primera ubicación (numérico) y deja sin ubicación al final', () => {
    const lines = [
      { key: 'a', reference: 'A' },
      { key: 'b', reference: 'B' },
      { key: 'c', reference: 'C' },
      { key: 'd', reference: 'D' },
    ];
    const out = ordenarPorUbicacion(lines, { a: ['B2'], b: ['A10'], d: ['A2', 'C1'] });
    expect(out.map((l) => l.key)).toEqual(['d', 'b', 'a', 'c']);
  });
});
