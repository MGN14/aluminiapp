import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/remisionInventory', () => ({ resyncRemisionInventory: vi.fn() }));

import { planearCierre, itemsParaImprimir, type ItemCierre } from './despachoCierre';

const items: ItemCierre[] = [
  { id: 'i1', reference: 'GL4102-3', product_name: 'Marco', units: 12, unit_cost: 85000 },
  { id: 'i2', reference: 'PC635-3', product_name: 'Perfil', units: 6, unit_cost: 42000 },
  { id: 'i3', reference: 'PC635-3', product_name: 'Perfil', units: 4, unit_cost: 42000 },
  { id: 'i4', reference: 'MN92', product_name: null, units: 20, unit_cost: 51000 },
];

describe('planearCierre', () => {
  it('si cuadra no ajusta nada', () => {
    const plan = planearCierre(items, { 'gl4102-3': 12, 'pc635-3': 10, 'mn-92': 20 }, { MN92: 'MN-92' }, true);
    expect(plan.resumen.cuadra).toBe(true);
    expect(plan.ajuste).toBeNull();
    expect(plan.ajustada).toBe(false);
  });

  it('con faltantes y "ajustar", deja los ítems en lo cargado (alias incluidos)', () => {
    const plan = planearCierre(items, { 'gl4102-3': 12, 'pc635-3': 8, 'mn-92': 0 }, { MN92: 'MN-92' }, true);
    expect(plan.ajustada).toBe(true);
    expect(plan.ajuste).toEqual({ updates: [{ id: 'i3', units: 2 }], deletes: ['i4'] });
    expect(plan.items.map((i) => [i.id, i.units])).toEqual([['i1', 12], ['i2', 6], ['i3', 2]]);
    expect(plan.items[0].unit_cost).toBe(85000); // el precio no se toca
  });

  it('sin "ajustar" la remisión queda igual', () => {
    const plan = planearCierre(items, { 'gl4102-3': 5 }, {}, false);
    expect(plan.resumen.cuadra).toBe(false);
    expect(plan.ajuste).toBeNull();
    expect(plan.items).toBe(items);
  });
});

describe('itemsParaImprimir', () => {
  it('omite líneas en 0 y usa la referencia si no hay descripción', () => {
    expect(itemsParaImprimir([...items, { id: 'x', reference: 'Z', product_name: null, units: 0, unit_cost: 0 }]).map((i) => i.product_name))
      .toEqual(['Marco', 'Perfil', 'Perfil', 'MN92']);
  });
});
