import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { computeStageDurations, computeTotalDays } from './importStages';
import { fechaEntregaImport, ordenarEntregados } from './importStages';

// Caso real: contenedor EN TRÁNSITO con una fila 'entregado' fantasma en el
// historial (mayo, venía del mapeo legacy de fecha_arribo_real). La regla de
// flujo dice que las etapas posteriores al estado actual no cuentan: la etapa
// en curso debe correr hasta hoy y el total no puede quedar congelado.

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-06T12:00:00'));
});
afterAll(() => vi.useRealTimers());

const conFantasma = [
  { estado: 'cotizacion', fecha: '2026-05-03' },
  { estado: 'produccion', fecha: '2026-05-10' },
  { estado: 'transito', fecha: '2026-06-06' },
  { estado: 'entregado', fecha: '2026-05-30' }, // fantasma — el pedido sigue en tránsito
];

describe('regla de flujo: etapas posteriores al estado actual no cuentan', () => {
  it('la etapa en curso suma hasta hoy aunque haya un entregado fantasma (cotización fuera del flujo)', () => {
    const stages = computeStageDurations(conFantasma, 'transito');
    expect(stages.map(s => s.estado)).toEqual(['produccion', 'transito']);
    const transito = stages[stages.length - 1];
    expect(transito.enCurso).toBe(true);
    expect(transito.dias).toBe(30); // 6 jun → 6 jul
  });

  it('el total corre desde que se MONTÓ el pedido (producción), no desde cotización', () => {
    const total = computeTotalDays(conFantasma, 'transito');
    expect(total).toEqual({ dias: 57, enCurso: true }); // 10 may (producción) → 6 jul
  });

  it('entregado sí cierra el total cuando el estado ES entregado', () => {
    const history = [
      { estado: 'cotizacion', fecha: '2026-05-03' },
      { estado: 'transito', fecha: '2026-06-06' },
      { estado: 'entregado', fecha: '2026-07-01' },
    ];
    // Sin fecha de producción: arranca en la primera etapa del flujo (tránsito).
    expect(computeTotalDays(history, 'entregado')).toEqual({ dias: 25, enCurso: false });
    const stages = computeStageDurations(history, 'entregado');
    expect(stages[stages.length - 1]).toMatchObject({ estado: 'entregado', enCurso: false });
  });

  it('legacy: si SOLO hay fecha de cotización, se usa como inicio (mejor que nada)', () => {
    const history = [{ estado: 'cotizacion', fecha: '2026-06-06' }];
    expect(computeTotalDays(history, 'cotizacion')).toEqual({ dias: 30, enCurso: true });
  });
});

describe('último entregado — orden por fecha de ENTREGA (fix 2026-10-08)', () => {
  // Datos reales de Nico.
  const c2026_1 = {
    id: '2026-1', estado: 'cerrado', fecha_arribo_real: '2026-07-26',
    import_estado_history: [
      { estado: 'produccion', fecha: '2026-04-29' }, { estado: 'transito', fecha: '2026-06-03' },
      { estado: 'aduana', fecha: '2026-07-09' }, { estado: 'entregado', fecha: '2026-07-26' }, { estado: 'cerrado', fecha: '2026-07-31' },
    ],
  };
  // Entregado HOY sin fecha de entrega ni arribo (el modal la borraba).
  const c2026_2 = {
    id: '2026-2', estado: 'entregado', fecha_arribo_real: null,
    import_estado_history: [
      { estado: 'produccion', fecha: '2026-06-23' }, { estado: 'listo_fabrica', fecha: '2026-07-22' },
      { estado: 'transito', fecha: '2026-08-10' }, { estado: 'aduana', fecha: '2026-09-24' },
    ],
  };
  const c2026_3 = { id: '2026-3', estado: 'transito', fecha_arribo_real: null, import_estado_history: [{ estado: 'produccion', fecha: '2026-07-06' }] };

  it('sin entrada a entregado ni arribo, usa la última etapa (aduana) como cota', () => {
    expect(fechaEntregaImport(c2026_1)).toBe('2026-07-26');
    expect(fechaEntregaImport(c2026_2)).toBe('2026-09-24');
  });

  it('2026-2 es el último entregado aunque se montó después y no tiene fecha de entrega', () => {
    const ord = ordenarEntregados([c2026_2, c2026_1, c2026_3]);
    expect(ord.map((r) => r.id)).toEqual(['2026-1', '2026-2']);
  });

  it('la fecha de entregado del historial manda sobre la columna legacy', () => {
    expect(fechaEntregaImport({ fecha_arribo_real: '2026-01-01', import_estado_history: [{ estado: 'entregado', fecha: '2026-02-01' }] })).toBe('2026-02-01');
  });

  it('cerrado no cuenta como fecha de entrega', () => {
    expect(fechaEntregaImport({ fecha_arribo_real: null, import_estado_history: [{ estado: 'aduana', fecha: '2026-05-01' }, { estado: 'cerrado', fecha: '2026-06-30' }] })).toBe('2026-05-01');
  });

  it('sin ningún dato devuelve null', () => {
    expect(fechaEntregaImport({ fecha_arribo_real: null, import_estado_history: [] })).toBeNull();
  });
});
