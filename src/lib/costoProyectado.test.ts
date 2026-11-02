import { describe, it, expect } from 'vitest';
import {
  buildRefCostSeries, computeCostoProyectado, estadoLoteDe,
  type RefCostPoint, type RefCostPointInput, type RefCostoInput,
} from './costoProyectado';

const pt = (o: Partial<RefCostPointInput>): RefCostPointInput => ({
  key: 'liv-40-3', reference: 'LIV-40-3', descripcion: 'Perfil', created_at: '2026-01-01',
  import_id: 'a', pedido: '2026-1', proveedor: 'Shandong', estado: 'entregado', proyectado: false,
  fecha: '2026-03-01', smm_usd_ton: 2500, trm: 4000, trmEstimada: false, costosEstimados: false,
  cantidad: 100, peso_kg: 50, fob_total_usd: 200, landed_unit_cop: 1000, landed_por_kg_cop: 2000,
  delta_unit_pct: null, fob_usd_kg: 4, prima_smm_usd_ton: 1500,
  ...o,
});

describe('estadoLoteDe — etapa del lote según el estado del pedido', () => {
  it('mapea entregado/cerrado a real, aduana y tránsito a embarcado, el resto a fábrica', () => {
    expect(estadoLoteDe('entregado')).toBe('entregado');
    expect(estadoLoteDe('cerrado')).toBe('entregado');
    expect(estadoLoteDe('aduana')).toBe('aduana');
    expect(estadoLoteDe('transito')).toBe('transito');
    expect(estadoLoteDe('produccion')).toBe('fabrica');
    expect(estadoLoteDe('listo_fabrica')).toBe('fabrica');
    expect(estadoLoteDe('cancelado')).toBeNull();
  });
});

describe('buildRefCostSeries — reales y proyectados en la misma serie', () => {
  it('ordena los reales por fecha con su Δ punto a punto; los proyectados van después, con Δ vs el último real', () => {
    const series = buildRefCostSeries([
      pt({ import_id: 'b', pedido: '2026-2', fecha: '2026-07-15', landed_unit_cop: 1100, cantidad: 300 }),
      pt({ import_id: 'a', pedido: '2026-1', fecha: '2026-03-01', landed_unit_cop: 1000, cantidad: 100 }),
      pt({ import_id: 'c', pedido: '2026-3', fecha: '2026-11-20', landed_unit_cop: 1210, estado: 'transito', proyectado: true, trmEstimada: true }),
    ]);
    expect(series).toHaveLength(1);
    const s = series[0];
    expect(s.reales.map((p) => p.pedido)).toEqual(['2026-1', '2026-2']);
    expect(s.proyectados.map((p) => p.pedido)).toEqual(['2026-3']);
    expect(s.points.map((p) => p.pedido)).toEqual(['2026-1', '2026-2', '2026-3']);
    expect(s.reales[1].delta_unit_pct).toBe(10);
    expect(s.proyectados[0].delta_unit_pct).toBe(10);       // 1210 vs último real 1100
    expect(s.first?.pedido).toBe('2026-1');
    expect(s.last?.pedido).toBe('2026-2');                  // el último REAL, no el proyectado
    expect(s.delta_total_pct).toBe(10);
    // Promedio ponderado por cantidad: (100×1000 + 300×1100) / 400 = 1075
    expect(s.avg_landed_unit_cop).toBe(1075);
    expect(s.delta_vs_avg_pct).toBeCloseTo(2.3, 1);
  });

  it('una variante que solo viene proyectada tiene serie sin first/last ni promedio', () => {
    const [s] = buildRefCostSeries([
      pt({ key: 'nueva', reference: 'NUEVA', estado: 'fabrica', proyectado: true, fecha: '2026-12-01' }),
    ]);
    expect(s.reales).toHaveLength(0);
    expect(s.first).toBeNull();
    expect(s.last).toBeNull();
    expect(s.avg_landed_unit_cop).toBeNull();
    expect(s.proyectados[0].delta_unit_pct).toBeNull();
  });

  it('separa variantes distintas aunque compartan familia', () => {
    const series = buildRefCostSeries([
      pt({ key: 'liv-40-3', reference: 'LIV-40-3' }),
      pt({ key: 'liv-40-2', reference: 'LIV-40-2', import_id: 'b' }),
    ]);
    expect(series.map((s) => s.key).sort()).toEqual(['liv-40-2', 'liv-40-3']);
  });
});

const lote = (o: Partial<RefCostPoint>): RefCostPoint => ({
  import_id: 'a', pedido: '2026-1', proveedor: 'Shandong', estado: 'entregado', proyectado: false,
  fecha: '2026-03-01', smm_usd_ton: null, trm: 4000, trmEstimada: false, costosEstimados: false,
  cantidad: 100, peso_kg: null, fob_total_usd: 0, landed_unit_cop: 1000, landed_por_kg_cop: null,
  delta_unit_pct: null, fob_usd_kg: null, prima_smm_usd_ton: null,
  ...o,
});

const ref = (o: Partial<RefCostoInput>): RefCostoInput => ({
  key: 'liv-40-3', familia: 'liv-40', reference: 'LIV-40-3', color: 'negro', descripcion: null,
  stockActual: 100, costoActual: 1000, costoActualFuente: 'variante',
  lotes: [lote({})], precioLista: 1416,
  ...o,
});

describe('computeCostoProyectado — a cuánto queda el inventario con lo que viene', () => {
  it('promedia el stock actual con lo que viene, ponderado por unidades', () => {
    const { refs } = computeCostoProyectado([ref({
      lotes: [
        lote({}),                                                                            // real 1000
        lote({ import_id: 'c', pedido: '2026-3', estado: 'transito', proyectado: true, fecha: '2026-11-20', landed_unit_cop: 1200, cantidad: 100 }),
      ],
    })], { ivaIncluido: false });
    const r = refs[0];
    expect(r.enCamino).toBe(100);
    expect(r.landedEnCamino).toBe(1200);
    expect(r.costoProyectado).toBe(1100);                 // (100×1000 + 100×1200) / 200
    expect(r.deltaCaminoVsActualPct).toBe(20);
    expect(r.deltaCaminoVsUltimoRealPct).toBe(20);
    expect(r.proximo?.pedido).toBe('2026-3');
    expect(r.ultimoReal?.pedido).toBe('2026-1');
    // Margen mayorista sobre el precio: (1416 − 1000)/1416 = 29,4% → (1416 − 1100)/1416 = 22,3%
    expect(r.margenActual).toBeCloseTo(0.294, 3);
    expect(r.margenProyectado).toBeCloseTo(0.223, 3);
    expect(r.riesgoProyectado).toBeNull();
  });

  it('sin nada en camino, el costo proyectado es el actual y no hay Δ (el promedio no se mueve solo)', () => {
    const { refs } = computeCostoProyectado([ref({})], { ivaIncluido: false });
    expect(refs[0].enCamino).toBe(0);
    expect(refs[0].costoProyectado).toBe(1000);
    expect(refs[0].deltaCaminoVsActualPct).toBeNull();
    expect(refs[0].margenProyectado).toBeCloseTo(refs[0].margenActual!, 6);
  });

  it('sin costo en el inventario, valora el stock al último real y lo declara', () => {
    const { refs } = computeCostoProyectado([ref({
      costoActual: null, costoActualFuente: null,
      lotes: [lote({}), lote({ import_id: 'c', proyectado: true, estado: 'fabrica', fecha: '2026-12-01', landed_unit_cop: 1300, cantidad: 300 })],
    })], { ivaIncluido: false });
    const r = refs[0];
    expect(r.costoBase).toBe(1000);
    expect(r.costoBaseFuente).toBe('ultimo_real');
    expect(r.costoProyectado).toBe(1225);                 // (100×1000 + 300×1300) / 400
    expect(r.deltaCaminoVsActualPct).toBeNull();          // no hay costo de inventario contra qué comparar
    expect(r.deltaCaminoVsUltimoRealPct).toBe(30);
  });

  it('sin stock, el costo proyectado es directamente lo que viene', () => {
    const { refs } = computeCostoProyectado([ref({
      stockActual: 0, costoActual: null, costoActualFuente: null,
      lotes: [lote({ import_id: 'c', proyectado: true, estado: 'aduana', fecha: '2026-11-10', landed_unit_cop: 900, cantidad: 50 })],
    })], { ivaIncluido: false });
    expect(refs[0].costoProyectado).toBe(900);
    expect(refs[0].ultimoReal).toBeNull();
  });

  it('marca riesgo y pérdida con el costo PROYECTADO, y descuenta el IVA de la lista si viene incluido', () => {
    const { refs, kpis } = computeCostoProyectado([
      ref({ key: 'riesgo', reference: 'RIESGO', precioLista: 1150,
        lotes: [lote({}), lote({ import_id: 'c', proyectado: true, estado: 'transito', fecha: '2026-11-20', landed_unit_cop: 1200, cantidad: 100 })] }), // proy 1100 → 4,3%
      ref({ key: 'perdida', reference: 'PERDIDA', precioLista: 1000,
        lotes: [lote({}), lote({ import_id: 'c', proyectado: true, estado: 'transito', fecha: '2026-11-20', landed_unit_cop: 1200, cantidad: 100 })] }), // proy 1100 → −10%
      ref({ key: 'sana', reference: 'SANA', precioLista: 2000 }),
      ref({ key: 'sinprecio', reference: 'SINPRECIO', precioLista: null }),
    ], { ivaIncluido: false });
    const byKey = Object.fromEntries(refs.map((r) => [r.key, r]));
    expect(byKey.riesgo.riesgoProyectado).toBe('riesgo');
    expect(byKey.riesgo.margenActual).toBeGreaterThan(byKey.riesgo.margenProyectado!);
    expect(byKey.perdida.riesgoProyectado).toBe('perdida');
    expect(byKey.sana.riesgoProyectado).toBeNull();
    expect(byKey.sinprecio.margenProyectado).toBeNull();
    expect(kpis.refsEnRiesgoProy).toBe(1);
    expect(kpis.refsEnPerdidaProy).toBe(1);
    expect(kpis.peorRef?.key).toBe('perdida');
    expect(kpis.refsConPrecio).toBe(3);

    const conIva = computeCostoProyectado([ref({ precioLista: 1416 * 1.19 })], { ivaIncluido: true, ivaPct: 19 });
    expect(conIva.refs[0].precioSinIva).toBeCloseTo(1416, 0);
  });

  it('KPIs: Δ de lo que viene ponderado por unidades, y conteo de las que suben/bajan más de 5%', () => {
    const { kpis } = computeCostoProyectado([
      // 100 und a 1200 vs actual 1000 → +20%
      ref({ key: 'a', reference: 'A', lotes: [lote({}), lote({ import_id: 'c', proyectado: true, estado: 'transito', fecha: '2026-11-20', landed_unit_cop: 1200, cantidad: 100 })] }),
      // 300 und a 900 vs actual 1000 → −10%
      ref({ key: 'b', reference: 'B', lotes: [lote({}), lote({ import_id: 'c', proyectado: true, estado: 'fabrica', fecha: '2026-12-20', landed_unit_cop: 900, cantidad: 300 })] }),
      // sin camino: no entra al Δ
      ref({ key: 'c', reference: 'C' }),
    ], { ivaIncluido: false });
    expect(kpis.refs).toBe(3);
    expect(kpis.refsConCamino).toBe(2);
    expect(kpis.unidadesEnCamino).toBe(400);
    // (100×1200 + 300×900) / (100×1000 + 300×1000) = 390.000 / 400.000 → −2,5%
    expect(kpis.deltaCaminoVsActualPct).toBe(-2.5);
    expect(kpis.refsSuben).toBe(1);
    expect(kpis.refsBajan).toBe(1);
    expect(kpis.margenActualPond).not.toBeNull();
    expect(kpis.margenProyectadoPond).not.toBeNull();
  });
});
