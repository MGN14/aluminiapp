import { describe, it, expect } from 'vitest';
import {
  buildComparativo,
  etapasMedidas,
  valorEnFecha,
  deltaPct,
  restanteDias,
  type PedidoComparable,
} from './importComparison';
import { estimateLeadTime } from './reorderSuggestion';

const base = (over: Partial<PedidoComparable> = {}): PedidoComparable => ({
  id: 'p1',
  label: 'PED-001',
  estado: 'entregado',
  cantidad_ton: 20,
  precio_smm_cerrado_usd_ton: 2500,
  monto_total_usd: 50_000,
  trm: 4000,
  arancel_pct: 5,
  iva_pct: 19,
  costs: [{ tipo: 'flete', monto: 3000, moneda: 'USD' }],
  fechas: {
    estado: 'entregado',
    fecha_anticipo: '2026-01-01',
    fecha_embarque: '2026-02-10',
    fecha_estimada_llegada: null,
    fecha_arribo_real: '2026-03-15',
    fecha_entregado: '2026-03-30',
    fecha_listo_fabrica: null,
  },
  ...over,
});

describe('etapasMedidas', () => {
  it('mide cada etapa con las fechas reales', () => {
    const e = etapasMedidas(base().fechas);
    expect(e.produccion).toBe(40);   // 1 ene -> 10 feb
    expect(e.transito).toBe(33);     // 10 feb -> 15 mar
    expect(e.nacionalizacion).toBe(15); // 15 mar -> 30 mar
    expect(e.total).toBe(88);
    expect(e.estimado).toBe(false);
  });

  it('produccion termina en listo_fabrica cuando existe (la retencion no cuenta)', () => {
    const e = etapasMedidas({ ...base().fechas, fecha_listo_fabrica: '2026-01-25' });
    expect(e.produccion).toBe(24);
  });

  it('deja null la etapa que no se puede medir', () => {
    const e = etapasMedidas({ ...base().fechas, fecha_entregado: null });
    expect(e.nacionalizacion).toBeNull();
    expect(e.total).toBeNull();
  });
});

describe('valorEnFecha', () => {
  const serie = [
    { date: '2026-01-01', value: 100 },
    { date: '2026-02-01', value: 110 },
    { date: '2026-03-01', value: 120 },
  ];

  it('toma el punto mas cercano hacia atras', () => {
    expect(valorEnFecha(serie, '2026-02-15')).toBe(110);
  });

  it('toma el ultimo si la fecha es posterior a toda la serie', () => {
    expect(valorEnFecha(serie, '2026-12-31')).toBe(120);
  });

  it('cae al primer punto si la serie arranca despues', () => {
    expect(valorEnFecha(serie, '2025-06-01')).toBe(100);
  });

  it('null con serie vacia', () => {
    expect(valorEnFecha([], '2026-01-01')).toBeNull();
  });
});

describe('restanteDias', () => {
  const lt = estimateLeadTime([]); // defaults

  it('en aduana solo falta nacionalizar', () => {
    const d = restanteDias(
      { estado: 'aduana', fecha_anticipo: null, fecha_embarque: null, fecha_estimada_llegada: null, fecha_arribo_real: null },
      lt,
    );
    expect(d).toBe(lt.nacionalizacion.dias);
  });

  it('listo en fabrica: transito + nacionalizacion', () => {
    const d = restanteDias(
      { estado: 'listo_fabrica', fecha_anticipo: '2026-01-01', fecha_embarque: null, fecha_estimada_llegada: null, fecha_arribo_real: null },
      lt,
    );
    expect(d).toBe(lt.transito.dias + lt.nacionalizacion.dias);
  });

  it('sin arrancar: el lead time completo', () => {
    const d = restanteDias(
      { estado: 'cotizacion', fecha_anticipo: null, fecha_embarque: null, fecha_estimada_llegada: null, fecha_arribo_real: null },
      lt,
    );
    expect(d).toBe(lt.totalDias);
  });
});

describe('buildComparativo', () => {
  const lmeHistoria = [
    { date: '2026-03-01', value: 2400 },
    { date: '2026-07-01', value: 2640 }, // +10%
  ];

  it('arma entregado + en curso + hoy', () => {
    const enCurso = base({
      id: 'p2',
      label: 'PED-002',
      estado: 'transito',
      fechas: {
        estado: 'transito',
        fecha_anticipo: '2026-05-01',
        fecha_embarque: '2026-06-20',
        fecha_estimada_llegada: null,
        fecha_arribo_real: null,
        fecha_entregado: null,
      },
    });
    const r = buildComparativo({
      pedidos: [base(), enCurso],
      hoy: '2026-07-31',
      trmHoy: 4200,
      lmeHoy: 2640,
      lmeHistoria,
    });
    expect(r.columnas.map((c) => c.kind)).toEqual(['entregado', 'en_curso', 'hoy']);
    expect(r.baseId).toBe('p1');
    expect(r.vacio).toBeNull();
  });

  it('la columna hoy mueve el precio por el LME y usa la TRM de hoy', () => {
    const r = buildComparativo({
      pedidos: [base()],
      hoy: '2026-07-31',
      trmHoy: 4200,
      lmeHoy: 2640,
      lmeHistoria,
    });
    const hoy = r.columnas.find((c) => c.kind === 'hoy')!;
    // LME 2400 (30 mar, punto de 1 mar) -> 2640 = +10% sobre el SMM de 2500.
    expect(hoy.precioUsdTon).toBeCloseTo(2750, 5);
    expect(hoy.trm).toBe(4200);
    expect(hoy.toneladas).toBe(20);
    expect(hoy.mercanciaUsd).toBeCloseTo(55_000, 5);
    expect(hoy.supuestos.length).toBeGreaterThan(0);
  });

  it('mas caro en USD y con TRM mas alta => COP/kg sube', () => {
    const r = buildComparativo({
      pedidos: [base()], hoy: '2026-07-31', trmHoy: 4200, lmeHoy: 2640, lmeHistoria,
    });
    const entregado = r.columnas.find((c) => c.kind === 'entregado')!;
    const hoy = r.columnas.find((c) => c.kind === 'hoy')!;
    expect(entregado.copPorKg).not.toBeNull();
    expect(hoy.copPorKg!).toBeGreaterThan(entregado.copPorKg!);
  });

  it('sin LME deja el precio igual y lo declara como supuesto', () => {
    const r = buildComparativo({
      pedidos: [base()], hoy: '2026-07-31', trmHoy: 4200, lmeHoy: null, lmeHistoria: [],
    });
    const hoy = r.columnas.find((c) => c.kind === 'hoy')!;
    expect(hoy.precioUsdTon).toBe(2500);
    expect(hoy.supuestos.some((s) => s.includes('no hay LME'))).toBe(true);
  });

  it('ignora cancelados', () => {
    const r = buildComparativo({
      pedidos: [base(), base({ id: 'x', estado: 'cancelado' })],
      hoy: '2026-07-31', trmHoy: 4200, lmeHoy: 2640, lmeHistoria,
    });
    expect(r.columnas.some((c) => c.id === 'x')).toBe(false);
  });

  it('sin entregados no arma la columna hoy y lo explica', () => {
    const r = buildComparativo({
      pedidos: [base({ estado: 'transito' })],
      hoy: '2026-07-31', trmHoy: 4200, lmeHoy: 2640, lmeHistoria,
    });
    expect(r.columnas.some((c) => c.kind === 'hoy')).toBe(false);
    expect(r.vacio).toContain('entregado');
  });

  it('sin pedidos devuelve vacio', () => {
    const r = buildComparativo({ pedidos: [], hoy: '2026-07-31', trmHoy: null, lmeHoy: null, lmeHistoria: [] });
    expect(r.columnas).toHaveLength(0);
    expect(r.vacio).toBeTruthy();
  });
});

describe('deltaPct', () => {
  it('calcula la variacion', () => {
    expect(deltaPct(110, 100)).toBeCloseTo(10);
    expect(deltaPct(90, 100)).toBeCloseTo(-10);
  });
  it('null si falta un lado o la base es cero', () => {
    expect(deltaPct(null, 100)).toBeNull();
    expect(deltaPct(100, null)).toBeNull();
    expect(deltaPct(100, 0)).toBeNull();
  });
});
