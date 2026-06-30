import { describe, it, expect } from 'vitest';
import {
  parseBancolombiaCardCsv,
  parseCardAmount,
  parseDateYYYYMMDD,
  toTransactionAmount,
  buildCardDescription,
} from './bancolombiaCardCsvParser';

// Muestra REAL del extracto de tarjeta de crédito Bancolombia (movimientos_2026_30_6.csv).
const SAMPLE = `NÚMERO DE PRODUCTO;TIPO CUENTA;EMISOR;FECHA;MONEDA;VALOR;PLAZO;FECHA FACTURACIÓN;TASA;
*2047;3;1;20260625;COP;$ 36,80;0;00000000;0000;
*2047;3;1;20260624;COP;$ 861.794,00;1;00000000;0000;
*2047;3;1;20260624;COP;$ 9.200,00;1;00000000;0000;
*2047;3;1;20260623;COP;$ 1.402,55;0;00000000;0000;
*2047;3;1;20260622;COP;$ 1.397,65;0;00000000;0000;
*2047;3;1;20260622;COP;$ 350.637,00;1;00000000;0000;
*2047;3;1;20260620;COP;$ 349.412,06;36;00000000;0000;
*2047;3;1;20260616;COP;-$ 1.170.231,93;0;00000000;0000;
*2047;3;1;20260615;COP;$ 361,60;0;00000000;0000;
*2047;3;1;20260611;COP;$ 90.400,00;1;00000000;0000;
*2047;3;1;20260601;COP;$ 47,60;0;00000000;0000;
*2047;3;1;20260531;COP;$ 1.189,28;0;20260531;0000;
*2047;3;1;20260531;COP;$ 133,00;0;20260531;0000;
*2047;3;1;20260531;COP;$ 33,60;0;20260531;0000;
*2047;3;1;20260531;COP;$ 33.250,00;0;20260531;0000;
*2047;3;1;20260530;COP;$ 11.900,00;1;00000000;0000;
*2047;3;1;20260528;COP;$ 297.320,00;1;20260531;0000;
*2047;3;1;20260528;COP;$ 8.400,00;1;20260531;0000;
*2047;3;1;20260527;COP;$ 14.145,57;0;20260531;0000;
*2047;3;1;20260526;COP;$ 3.536.393,00;12;20260531;0000;
*2047;3;1;20260525;COP;$ 8,00;0;20260531;0000;
*2047;3;1;20260522;COP;$ 2.000,00;1;20260531;0000;
*2047;3;1;20260521;COP;$ 1.840,00;0;20260531;0000;
*2047;3;1;20260520;COP;$ 882,89;0;20260531;0000;
*2047;3;1;20260520;COP;$ 459.999,00;1;20260531;0000;
*2047;3;1;20260519;COP;$ 200,00;0;20260531;0000;
*2047;3;1;20260519;COP;$ 220.722,00;36;20260531;0000;
*2047;3;1;20260516;COP;$ 50.000,00;1;20260531;0000;
`;

describe('parseCardAmount', () => {
  it('parsea formato colombiano con miles y decimales', () => {
    expect(parseCardAmount('$ 36,80')).toBe(36.8);
    expect(parseCardAmount('$ 861.794,00')).toBe(861794);
    expect(parseCardAmount('$ 3.536.393,00')).toBe(3536393);
    expect(parseCardAmount('$ 1.170.231,93')).toBe(1170231.93);
  });
  it('respeta el signo negativo (abono/pago)', () => {
    expect(parseCardAmount('-$ 1.170.231,93')).toBe(-1170231.93);
  });
  it('devuelve null para basura', () => {
    expect(parseCardAmount('')).toBeNull();
    expect(parseCardAmount('abc')).toBeNull();
  });
});

describe('parseDateYYYYMMDD', () => {
  it('convierte YYYYMMDD a ISO', () => {
    expect(parseDateYYYYMMDD('20260625')).toBe('2026-06-25');
    expect(parseDateYYYYMMDD('20260531')).toBe('2026-05-31');
  });
  it('00000000 y fechas inválidas → null', () => {
    expect(parseDateYYYYMMDD('00000000')).toBeNull();
    expect(parseDateYYYYMMDD('20260231')).toBeNull(); // 31 de feb no existe
    expect(parseDateYYYYMMDD('1234')).toBeNull();
  });
});

describe('parseBancolombiaCardCsv', () => {
  const res = parseBancolombiaCardCsv(SAMPLE);

  it('parsea todas las filas sin errores y salta el encabezado', () => {
    expect(res.errors).toHaveLength(0);
    expect(res.movements).toHaveLength(28);
  });

  it('clasifica compras vs abonos por el signo del VALOR', () => {
    const charges = res.movements.filter((m) => m.isCharge);
    const payments = res.movements.filter((m) => !m.isCharge);
    expect(charges).toHaveLength(27);
    expect(payments).toHaveLength(1);
  });

  it('el abono (negativo) queda como payment positivo', () => {
    const pago = res.movements.find((m) => !m.isCharge)!;
    expect(pago.date).toBe('2026-06-16');
    expect(pago.rawValue).toBe(-1170231.93);
    expect(pago.payment).toBe(1170231.93);
    expect(pago.charge).toBeNull();
  });

  it('una compra normal queda como charge positivo', () => {
    const compra = res.movements.find((m) => m.date === '2026-06-25')!;
    expect(compra.rawValue).toBe(36.8);
    expect(compra.charge).toBe(36.8);
    expect(compra.payment).toBeNull();
    expect(compra.product).toBe('*2047');
    expect(compra.currency).toBe('COP');
  });

  it('lee cuotas (PLAZO) y fecha de facturación', () => {
    const diferido = res.movements.find((m) => m.installments === 36 && m.date === '2026-06-20')!;
    expect(diferido.installments).toBe(36);
    expect(diferido.billingDate).toBeNull(); // 00000000
    const facturado = res.movements.find((m) => m.date === '2026-05-28' && m.installments === 1)!;
    expect(facturado.billingDate).toBe('2026-05-31');
  });

  it('totaliza el abono correctamente', () => {
    expect(res.summary.totalPayments).toBe(1170231.93);
    expect(res.summary.products).toEqual(['*2047']);
    expect(res.summary.dateRange).toEqual({ start: '2026-05-16', end: '2026-06-25' });
  });
});

describe('integración con transactions', () => {
  const res = parseBancolombiaCardCsv(SAMPLE);
  it('una compra se mapea a egreso (amount negativo)', () => {
    const compra = res.movements.find((m) => m.date === '2026-06-25')!;
    expect(toTransactionAmount(compra)).toBe(-36.8);
    expect(buildCardDescription(compra)).toBe('Compra TC *2047');
  });
  it('un abono se mapea a ingreso (amount positivo)', () => {
    const pago = res.movements.find((m) => !m.isCharge)!;
    expect(toTransactionAmount(pago)).toBe(1170231.93);
    expect(buildCardDescription(pago)).toBe('Pago/abono TC *2047');
  });
  it('describe cuotas cuando aplica', () => {
    const diferido = res.movements.find((m) => m.installments === 12)!;
    expect(buildCardDescription(diferido)).toBe('Compra TC *2047 (12 cuotas)');
  });
});
