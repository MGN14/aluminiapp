import { describe, it, expect } from 'vitest';
import { diasRestantes, enEsteMes, sumaMontos, ventanasObligaciones } from './obligationWindows';

const d = (iso: string) => new Date(iso);

describe('diasRestantes', () => {
  // Los eventos del calendario se crean a las 12:00 locales.
  it('"Hoy" dura todo el día, sin importar la hora', () => {
    const vence = d('2026-10-22T12:00:00');
    expect(diasRestantes(vence, d('2026-10-22T09:00:00'))).toBe(0);
    expect(diasRestantes(vence, d('2026-10-22T13:00:00'))).toBe(0);
    expect(diasRestantes(vence, d('2026-10-22T23:59:00'))).toBe(0);
  });

  it('al día siguiente ya cuenta como vencida, incluso a las 9 am', () => {
    const vence = d('2026-10-22T12:00:00');
    expect(diasRestantes(vence, d('2026-10-23T09:00:00'))).toBe(-1);
    expect(diasRestantes(vence, d('2026-10-30T18:00:00'))).toBe(-8);
  });

  it('cuenta días calendario hacia adelante', () => {
    const hoy = d('2026-10-22T16:00:00');
    expect(diasRestantes(d('2026-10-23T12:00:00'), hoy)).toBe(1);
    expect(diasRestantes(d('2026-10-29T12:00:00'), hoy)).toBe(7);
    expect(diasRestantes(d('2026-11-30T12:00:00'), hoy)).toBe(39);
  });
});

describe('enEsteMes', () => {
  it('compara año y mes, no días', () => {
    const hoy = d('2026-10-22T10:00:00');
    expect(enEsteMes(d('2026-10-01T12:00:00'), hoy)).toBe(true);
    expect(enEsteMes(d('2026-10-31T12:00:00'), hoy)).toBe(true);
    expect(enEsteMes(d('2026-11-01T12:00:00'), hoy)).toBe(false);
    expect(enEsteMes(d('2025-10-15T12:00:00'), hoy)).toBe(false);
  });
});

describe('sumaMontos', () => {
  it('ignora montos nulos, cero y negativos', () => {
    expect(sumaMontos([{ monto: 1000 }, { monto: null }, {}, { monto: 0 }, { monto: -5 }, { monto: 250 }])).toBe(1250);
  });
});

describe('ventanasObligaciones', () => {
  // Caso de la captura de Nico (22 de oct): retefuente hoy, 4 pagos el 30,
  // una vencida de septiembre sin marcar, y cosas de noviembre que NO deben
  // sumar al encabezado.
  const hoy = d('2026-10-22T15:00:00');
  const items = [
    { id: 'ret-sep', fecha: d('2026-10-22T12:00:00'), monto: 918_658 },
    { id: 'nom-lina', fecha: d('2026-10-30T12:00:00'), monto: 1_000_000 },
    { id: 'arriendo', fecha: d('2026-10-30T12:00:00'), monto: 1_669_000 },
    { id: 'nom-angie', fecha: d('2026-10-30T12:00:00'), monto: 1_100_000 },
    { id: 'nom-yola', fecha: d('2026-10-30T12:00:00'), monto: 860_000 },
    { id: 'ica-vencida', fecha: d('2026-09-18T12:00:00'), monto: 400_000 },
    { id: 'iva-nov', fecha: d('2026-11-17T12:00:00'), monto: 5_000_000 },
    { id: 'eta-import', fecha: d('2026-10-28T12:00:00'), monto: null },
  ];
  const v = ventanasObligaciones(items, hoy);

  it('la semana son los próximos 7 días, sin vencidas', () => {
    expect(v.semana.map(x => x.id)).toEqual(['ret-sep', 'eta-import']);
    expect(sumaMontos(v.semana)).toBe(918_658);
  });

  it('el mes es todo octubre, con la vencida de octubre si la hubiera, sin noviembre', () => {
    expect(v.mes.map(x => x.id)).toEqual(['ret-sep', 'eta-import', 'nom-lina', 'arriendo', 'nom-angie', 'nom-yola']);
    expect(sumaMontos(v.mes)).toBe(5_547_658);
  });

  it('las vencidas de otros meses quedan aparte y entran a la lista primero', () => {
    expect(v.vencidas.map(x => x.id)).toEqual(['ica-vencida']);
    expect(v.lista[0].id).toBe('ica-vencida');
    expect(v.lista.map(x => x.id)).not.toContain('iva-nov');
  });

  it('a fin de mes la semana se asoma al mes siguiente', () => {
    const fin = ventanasObligaciones(
      [{ id: 'a', fecha: d('2026-11-03T12:00:00') }, { id: 'b', fecha: d('2026-11-20T12:00:00') }],
      d('2026-10-29T10:00:00'),
    );
    expect(fin.semana.map(x => x.id)).toEqual(['a']);
    expect(fin.mes).toEqual([]);
    expect(fin.lista.map(x => x.id)).toEqual(['a']);
  });
});
