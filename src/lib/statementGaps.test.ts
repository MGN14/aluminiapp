import { describe, it, expect } from 'vitest';
import { findCoverageGaps, findSeriesAtrasadas } from './statementGaps';

describe('findCoverageGaps — huecos de días entre extractos de la misma cuenta', () => {
  it('el caso original: 20/05–01/06 y después 08/06–02/07 deja 02/06–07/06 sin datos', () => {
    const gaps = findCoverageGaps([
      { bank_name: 'Bancolombia', period_start: '2026-05-20', period_end: '2026-06-01' },
      { bank_name: 'Bancolombia', period_start: '2026-06-08', period_end: '2026-07-02' },
    ]);
    expect(gaps).toEqual([{ bank: 'Bancolombia', from: '2026-06-02', to: '2026-06-07', days: 6 }]);
  });

  it('extractos contiguos o solapados no son hueco, y cada banco va por su lado', () => {
    expect(findCoverageGaps([
      { bank_name: 'Bancolombia', period_start: '2026-09-01', period_end: '2026-09-30' },
      { bank_name: 'Bancolombia', period_start: '2026-10-01', period_end: '2026-10-31' },
      { bank_name: 'Bancolombia', period_start: '2026-10-15', period_end: '2026-10-31' },
      { bank_name: 'Davivienda', period_start: '2026-05-01', period_end: '2026-05-31' },
    ])).toEqual([]);
  });
});

describe('findSeriesAtrasadas — una cuenta que se quedó sin extractos', () => {
  const principal = [
    { bank_name: 'Bancolombia', period_start: '2026-09-01', period_end: '2026-09-30' },
    { bank_name: 'Bancolombia', period_start: '2026-10-01', period_end: '2026-10-31' },
  ];

  it('el caso real: tarjeta hasta el 25 de junio y segunda cuenta hasta el 31 de mayo', () => {
    const out = findSeriesAtrasadas([
      ...principal,
      { bank_name: 'Tarjeta de crédito Bancolombia', period_start: '2026-05-16', period_end: '2026-06-25' },
      { bank_name: 'Davivienda', period_start: '2026-05-01', period_end: '2026-05-31' },
    ]);
    expect(out).toEqual([
      { bank: 'Davivienda', hasta: '2026-05-31', diasAtras: 153 },
      { bank: 'Tarjeta de crédito Bancolombia', hasta: '2026-06-25', diasAtras: 128 },
    ]);
  });

  it('una cuenta un mes atrás no es atraso: es el extracto que todavía no llega', () => {
    expect(findSeriesAtrasadas([
      ...principal,
      { bank_name: 'Davivienda', period_start: '2026-09-01', period_end: '2026-09-30' },
    ])).toEqual([]);
  });

  it('con una sola cuenta no hay contra qué comparar', () => {
    expect(findSeriesAtrasadas(principal)).toEqual([]);
  });

  it('ignora extractos sin período y usa el último día de cada cuenta', () => {
    expect(findSeriesAtrasadas([
      ...principal,
      { bank_name: 'Davivienda', period_start: null, period_end: null },
      { bank_name: 'Davivienda', period_start: '2026-03-01', period_end: '2026-03-31' },
      { bank_name: 'Davivienda', period_start: '2026-02-01', period_end: '2026-02-28' },
    ])).toEqual([{ bank: 'Davivienda', hasta: '2026-03-31', diasAtras: 214 }]);
  });
});
