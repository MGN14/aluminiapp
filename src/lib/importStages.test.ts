import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { computeStageDurations, computeTotalDays } from './importStages';

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
  it('la etapa en curso suma hasta hoy aunque haya un entregado fantasma', () => {
    const stages = computeStageDurations(conFantasma, 'transito');
    expect(stages.map(s => s.estado)).toEqual(['cotizacion', 'produccion', 'transito']);
    const transito = stages[stages.length - 1];
    expect(transito.enCurso).toBe(true);
    expect(transito.dias).toBe(30); // 6 jun → 6 jul
  });

  it('el total corre hasta hoy si el pedido no está entregado', () => {
    const total = computeTotalDays(conFantasma, 'transito');
    expect(total).toEqual({ dias: 64, enCurso: true }); // 3 may → 6 jul
  });

  it('entregado sí cierra el total cuando el estado ES entregado', () => {
    const history = [
      { estado: 'cotizacion', fecha: '2026-05-03' },
      { estado: 'transito', fecha: '2026-06-06' },
      { estado: 'entregado', fecha: '2026-07-01' },
    ];
    expect(computeTotalDays(history, 'entregado')).toEqual({ dias: 59, enCurso: false });
    const stages = computeStageDurations(history, 'entregado');
    expect(stages[stages.length - 1]).toMatchObject({ estado: 'entregado', enCurso: false });
  });
});
