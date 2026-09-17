/**
 * Obligaciones desde patrones — con los pagos REALES de Nico (2026-09-16):
 * Yolanda y LINA quincenal (15 y 30), Angie fin de mes, Compensar 15-19.
 */
import { describe, it, expect } from 'vitest';
import { planObligationsFromPattern, coveredByManualObligation, inferTipo, mesesFromFrequency } from './obligationPlan';

const YOLANDA = { description: 'Nómina — Yolanda', estimated_amount: 1_206_536, estimated_date: '2026-09-17', frequency_days: 17, occurrences: 16 };
const YOLANDA_TXS = [
  ['2026-03-17', 1_000_000], ['2026-03-31', 860_000], ['2026-04-17', 1_000_000], ['2026-04-30', 860_000],
  ['2026-05-16', 1_000_000], ['2026-05-29', 860_000], ['2026-06-16', 1_000_000], ['2026-06-30', 1_000_000],
  ['2026-06-30', 860_000], ['2026-07-15', 1_000_000], ['2026-07-31', 860_000], ['2026-08-16', 1_000_000], ['2026-08-31', 860_000],
].map(([date, amount]) => ({ date: date as string, amount: amount as number }));

describe('quincenal → dos filas con el día y la plata reales', () => {
  const planes = planObligationsFromPattern(YOLANDA, YOLANDA_TXS);
  it('crea 1ª y 2ª quincena, tipo nómina, todos los meses', () => {
    expect(planes).toHaveLength(2);
    expect(planes[0].nombre).toBe('Nómina — Yolanda (1ª quincena)');
    expect(planes[1].nombre).toBe('Nómina — Yolanda (2ª quincena)');
    expect(planes.every((p) => p.tipo === 'nomina')).toBe(true);
    expect(planes.every((p) => p.meses.length === 12)).toBe(true);
  });
  it('el día es la mediana de los pagos (16 y 30), NO el de la proyección (17)', () => {
    expect(planes[0].dia_mes).toBe(16);
    expect(planes[1].dia_mes).toBe(30);
  });
  it('el monto es la mediana por quincena ($1M y $860k)', () => {
    expect(planes[0].monto_estimado).toBe(1_000_000);
    expect(planes[1].monto_estimado).toBe(860_000);
  });
  it('sin pagos cae a 15 y 30 con el monto estimado', () => {
    const sin = planObligationsFromPattern(YOLANDA, []);
    expect(sin.map((p) => p.dia_mes)).toEqual([15, 30]);
    expect(sin[0].monto_estimado).toBe(1_206_536);
  });
});

describe('mensual → una fila con el día típico y todos los meses', () => {
  const ANGIE = { description: 'Nómina — Angie', estimated_amount: 1_422_250, estimated_date: '2026-09-20', frequency_days: 25, occurrences: 10 };
  const txs = [['2026-03-31', 700_000], ['2026-04-30', 1_305_000], ['2026-05-29', 1_500_000], ['2026-06-30', 1_000_000], ['2026-07-02', 1_100_000], ['2026-07-31', 1_100_000], ['2026-08-26', 1_600_000]]
    .map(([date, amount]) => ({ date: date as string, amount: amount as number }));
  it('Angie cobra a fin de mes: día 30, $1.1M, 12 meses (antes: día 20, un mes)', () => {
    const [p] = planObligationsFromPattern(ANGIE, txs);
    expect(p.dia_mes).toBe(30);
    expect(p.monto_estimado).toBe(1_100_000);
    expect(p.meses).toHaveLength(12);
    expect(p.tipo).toBe('nomina');
  });
  it('Compensar es PILA (día ~17)', () => {
    const COMP = { description: 'Nómina — Compensar', estimated_amount: 2_605_300, estimated_date: '2026-09-18', frequency_days: 31, occurrences: 6 };
    const t = ['03-18', '04-16', '05-19', '06-16', '07-15', '08-18'].map((d) => ({ date: `2026-${d}`, amount: 2_500_000 }));
    const [p] = planObligationsFromPattern(COMP, t);
    expect(p.tipo).toBe('pila');
    expect(p.dia_mes).toBe(17);
  });
  it('frecuencia larga → cada N meses desde el estimado', () => {
    expect(mesesFromFrequency(49, '2026-10-10')).toEqual(['2', '4', '6', '8', '10', '12']);
    expect(mesesFromFrequency(90, '2026-11-01')).toEqual(['2', '5', '8', '11']);
    expect(mesesFromFrequency(31, '2026-09-01')).toHaveLength(12);
  });
});

describe('tipo según la categoría', () => {
  it('mapea los prefijos conocidos', () => {
    expect(inferTipo('Nómina — Angie')).toBe('nomina');
    expect(inferTipo('Servicios — Serjunico')).toBe('servicios');
    expect(inferTipo('Arriendo — Local')).toBe('arriendo');
    expect(inferTipo('Impuestos — DIAN')).toBe('otro');
    expect(inferTipo('Gastos Operativos — Rocio Gaitan')).toBe('otro');
  });
});

describe('dedupe contra obligaciones manuales', () => {
  const manuales = [
    { nombre: 'MiPlanilla', dia_mes: 15, monto_estimado: 2_800_000 },
    { nombre: 'TIGO', dia_mes: 20, monto_estimado: 400_000 },
  ];
  it('"Nómina — Compensar" (día 18, $2.6M) es MiPlanilla (día 15, $2.8M): misma plata y fecha', () => {
    expect(coveredByManualObligation({ description: 'Nómina — Compensar', estimated_amount: 2_605_300, estimated_date: '2026-09-18' }, manuales)).toBe(true);
  });
  it('misma plata pero a 12 días NO es la misma', () => {
    expect(coveredByManualObligation({ description: 'Nómina — Compensar', estimated_amount: 2_605_300, estimated_date: '2026-09-27' }, manuales)).toBe(false);
  });
  it('nombre parecido sigue deduplicando aunque cambie la plata', () => {
    expect(coveredByManualObligation({ description: 'Servicios — Tigo', estimated_amount: 900_000, estimated_date: '2026-09-05' }, manuales)).toBe(true);
  });
  it('el 30 y el 2 están a 3 días (distancia circular)', () => {
    expect(coveredByManualObligation({ description: 'Nómina — X', estimated_amount: 400_000, estimated_date: '2026-09-02' }, [{ nombre: 'Y', dia_mes: 30, monto_estimado: 400_000 }])).toBe(true);
  });
});
