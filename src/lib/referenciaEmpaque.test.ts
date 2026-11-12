import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { parseDecimal, planGuardadoEmpaque, esFaltaColumna, type EmpaqueVariante } from './referenciaEmpaque';

const v = (id: string, ref: string, pp: number | null = null, kg: number | null = null): EmpaqueVariante =>
  ({ id, variant_reference: ref, unidades_por_paquete: pp, kg_por_unidad: kg });

describe('parseDecimal', () => {
  it('coma y punto son decimales en números simples', () => {
    expect(parseDecimal('2,35')).toBe(2.35);
    expect(parseDecimal('2.35')).toBe(2.35);
    expect(parseDecimal('2,357')).toBe(2.357);
    expect(parseDecimal('10')).toBe(10);
  });
  it('miles + decimales con el parser general', () => {
    expect(parseDecimal('1.234,5')).toBe(1234.5);
  });
  it('vacío, cero o basura = sin dato', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('0')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});

describe('planGuardadoEmpaque', () => {
  const variantes = [
    v('a', 'PC635-3', null, null),
    v('b', 'PC635-2', 10, null),
    v('c', 'PC635-0', null, 2.4),
    v('d', 'GL4102-3', null, null),
  ];
  it('guarda en la referencia y rellena los otros colores vacíos sin pisar', () => {
    expect(planGuardadoEmpaque(variantes, 'PC635-3', { unidades_por_paquete: 6, kg_por_unidad: 2.5 })).toEqual([
      { id: 'a', patch: { unidades_por_paquete: 6, kg_por_unidad: 2.5 } },
      { id: 'b', patch: { kg_por_unidad: 2.5 } },
      { id: 'c', patch: { unidades_por_paquete: 6 } },
    ]);
  });
  it('con «todos los colores» pisa también lo que ya tenían', () => {
    expect(planGuardadoEmpaque(variantes, 'pc635-3', { unidades_por_paquete: 6 }, true)).toEqual([
      { id: 'a', patch: { unidades_por_paquete: 6 } },
      { id: 'b', patch: { unidades_por_paquete: 6 } },
      { id: 'c', patch: { unidades_por_paquete: 6 } },
    ]);
  });
  it('solo toca el campo que cambió y nada de otras familias', () => {
    expect(planGuardadoEmpaque(variantes, 'GL4102-3', { kg_por_unidad: 5 })).toEqual([{ id: 'd', patch: { kg_por_unidad: 5 } }]);
  });
});

describe('esFaltaColumna', () => {
  it('reconoce la migración sin aplicar', () => {
    expect(esFaltaColumna({ code: '42703', message: 'column inventory_variants.kg_por_unidad does not exist' })).toBe(true);
    expect(esFaltaColumna({ code: '23505', message: 'duplicate' })).toBe(false);
  });
});
