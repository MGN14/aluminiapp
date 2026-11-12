import { describe, it, expect } from 'vitest';
import { makeCanon } from './despachoCargue';
import {
  resolverEmpaques, paquetesDe, textoPaquetes, cargadoEnPaquetes, siguientePaquete,
  ordenarCargue, moverEnOrden, totalesCargue, pesoLinea,
} from './cargueEmpaque';

const canon = makeCanon({ MN92: 'MN-92' });
const lines = [
  { key: 'gl4102-3', reference: 'GL4102-3', pedido: 12 },
  { key: 'pc635-3', reference: 'PC635-3', pedido: 100 },
  { key: 'mn-92', reference: 'MN92', pedido: 20 },
  { key: '744-100', reference: '744-100', pedido: 6 },
];

describe('resolverEmpaques', () => {
  const importItems = [
    // contenedor viejo y uno nuevo de la misma ref: manda el más reciente
    { reference: 'PC635-3', cantidad: 600, bultos: 100, unidad: 'und', peso_kg: 1800, created_at: '2026-05-01' },
    { reference: 'PC635-3', cantidad: 600, bultos: 60, unidad: 'und', peso_kg: 1500, created_at: '2026-09-01' },
    // otra color de la familia GL4102: sirve para la -3
    { reference: 'GL4102-2', cantidad: 400, bultos: 40, unidad: 'und', peso_kg: 2000, created_at: '2026-08-01' },
    // en kilos: no sirve para piezas por paquete
    { reference: '744-100', cantidad: 500, bultos: 10, unidad: 'kg', peso_kg: 500, created_at: '2026-08-01' },
  ];
  const productos = [{ reference: 'MN-92', units_per_package: 8 }, { reference: '744-100-5', units_per_package: 12 }];

  it('toma el packing list más reciente (cantidad ÷ bultos y peso ÷ cantidad)', () => {
    const e = resolverEmpaques(lines, canon, { importItems, productos });
    expect(e['pc635-3']).toEqual({ porPaquete: 10, kgPorUnidad: 2.5, fuente: 'contenedor' });
  });
  it('cae a la misma familia de color cuando la ref exacta no vino en contenedor', () => {
    const e = resolverEmpaques(lines, canon, { importItems, productos });
    expect(e['gl4102-3']).toEqual({ porPaquete: 10, kgPorUnidad: 5, fuente: 'contenedor-familia' });
  });
  it('cae al maestro (alias y familia -5) y no usa contenedores en kilos', () => {
    const e = resolverEmpaques(lines, canon, { importItems, productos });
    expect(e['mn-92'].porPaquete).toBe(8);
    expect(e['mn-92'].fuente).toBe('maestro');
    expect(e['744-100']).toEqual({ porPaquete: 12, kgPorUnidad: null, fuente: 'maestro' });
  });
  it('lo ajustado en el plan manda sobre todo', () => {
    const e = resolverEmpaques(lines, canon, { importItems, productos, ajustes: { 'pc635-3': 6 } });
    expect(e['pc635-3']).toEqual({ porPaquete: 6, kgPorUnidad: 2.5, fuente: 'plan' });
  });
  it('Referencias por variante manda sobre el packing list (misma ref y otro color)', () => {
    const referencias = [
      { variant_reference: 'PC635-3', unidades_por_paquete: 8, kg_por_unidad: 2.8 },
      { variant_reference: 'GL4102-0', unidades_por_paquete: 12, kg_por_unidad: null },
    ];
    const e = resolverEmpaques(lines, canon, { importItems, productos, referencias });
    expect(e['pc635-3']).toEqual({ porPaquete: 8, kgPorUnidad: 2.8, fuente: 'referencia' });
    // GL4102-3 toma el paquete de su familia (-0) y el peso del contenedor
    expect(e['gl4102-3']).toEqual({ porPaquete: 12, kgPorUnidad: 5, fuente: 'referencia-familia' });
    // el ajuste de la remisión sigue mandando sobre todo
    expect(resolverEmpaques(lines, canon, { referencias, ajustes: { 'pc635-3': 5 } })['pc635-3'].porPaquete).toBe(5);
  });
  it('sin ningún dato queda marcado', () => {
    expect(resolverEmpaques([{ key: 'x', reference: 'X' }], canon)['x']).toEqual({ porPaquete: null, kgPorUnidad: null, fuente: 'sin-dato' });
  });
});

describe('paquetesDe / textoPaquetes', () => {
  it('paquetes exactos', () => {
    expect(paquetesDe(120, 6)).toEqual({ completos: 20, resto: 0, total: 20 });
    expect(textoPaquetes(paquetesDe(120, 6), 6)).toBe('20 paq × 6');
  });
  it('con un paquete incompleto (excepción)', () => {
    expect(paquetesDe(100, 6)).toEqual({ completos: 16, resto: 4, total: 17 });
    expect(textoPaquetes(paquetesDe(100, 6), 6)).toBe('16 paq × 6 + 1 de 4');
    expect(textoPaquetes(paquetesDe(4, 6), 6)).toBe('1 paq de 4');
  });
  it('sin medida', () => {
    expect(textoPaquetes(paquetesDe(10, null), null)).toBe('Sin medida de paquete');
  });
});

describe('cargadoEnPaquetes', () => {
  it('cada evento es un paquete; suma unidades; alias incluidos', () => {
    const c = cargadoEnPaquetes([
      { id: '1', reference: 'PC635-3', quantity: 6 },
      { id: '2', reference: 'pc635-3', quantity: 6 },
      { id: '3', reference: 'PC635-3', quantity: 4 },
      { id: '4', reference: 'MN-92', quantity: 8 },
      { id: '5', reference: 'MN92', quantity: -8 }, // ajuste negativo de la estación vieja
    ], canon);
    expect(c['pc635-3']).toEqual({ paquetes: 3, unidades: 16 });
    expect(c['mn-92']).toEqual({ paquetes: 0, unidades: 0 });
  });
});

describe('siguientePaquete', () => {
  it('estándar mientras alcance; el último incompleto trae lo que falta', () => {
    expect(siguientePaquete(100, 0, 6)).toBe(6);
    expect(siguientePaquete(100, 96, 6)).toBe(4);
    expect(siguientePaquete(100, 100, 6)).toBe(6);
    expect(siguientePaquete(5, 0, null)).toBe(5);
  });
});

describe('ordenarCargue', () => {
  const empaques = resolverEmpaques(lines, canon, {
    importItems: [
      { reference: 'PC635-3', cantidad: 10, bultos: 1, unidad: 'und', peso_kg: 25 },  // 2.5 kg × 100 = 250
      { reference: 'GL4102-3', cantidad: 10, bultos: 1, unidad: 'und', peso_kg: 50 }, // 5 kg × 12 = 60
      { reference: 'MN-92', cantidad: 10, bultos: 1, unidad: 'und', peso_kg: 40 },    // 4 kg × 20 = 80
    ],
  });
  it('más pesado primero; sin peso al final', () => {
    expect(ordenarCargue(lines, 'peso', { empaques })).toEqual(['pc635-3', 'mn-92', 'gl4102-3', '744-100']);
  });
  it('por ubicación', () => {
    expect(ordenarCargue(lines, 'ubicacion', { ubicaciones: { 'mn-92': ['A1'], '744-100': ['B2'] } }))
      .toEqual(['mn-92', '744-100', 'gl4102-3', 'pc635-3']);
  });
  it('como viene la remisión', () => {
    expect(ordenarCargue(lines, 'remision')).toEqual(['gl4102-3', 'pc635-3', 'mn-92', '744-100']);
  });
  it('manual respeta el orden guardado y agrega lo nuevo al final', () => {
    expect(ordenarCargue(lines, 'manual', { ordenManual: ['mn-92', 'borrada', 'gl4102-3'] }))
      .toEqual(['mn-92', 'gl4102-3', 'pc635-3', '744-100']);
  });
  it('moverEnOrden sube y baja sin salirse', () => {
    expect(moverEnOrden(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moverEnOrden(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('totalesCargue', () => {
  it('suma paquetes del plan, cargados y peso conocido', () => {
    const empaques = { 'gl4102-3': { porPaquete: 6, kgPorUnidad: 5, fuente: 'contenedor' as const }, 'pc635-3': { porPaquete: 6, kgPorUnidad: null, fuente: 'maestro' as const } };
    const t = totalesCargue(lines.slice(0, 2), empaques, { 'gl4102-3': { paquetes: 1, unidades: 6 } });
    expect(t).toEqual({ paquetesPlan: 2 + 17, paquetesCargados: 1, pesoKg: 60, refsSinPeso: 1, refsSinEmpaque: 0 });
    expect(pesoLinea(10, null)).toBeNull();
  });
});
