import { describe, it, expect } from 'vitest';
import { parseDelimited, parseLooseNumber } from './delimitedParser';

describe('parseLooseNumber — formato es-CO (punto = miles)', () => {
  it('trata el punto como miles cuando hay 3 dígitos detrás', () => {
    expect(parseLooseNumber('2.600')).toBe(2600);
    expect(parseLooseNumber('3.120')).toBe(3120);
    expect(parseLooseNumber('12.500')).toBe(12500);
    expect(parseLooseNumber('1.000')).toBe(1000);
  });
  it('trata múltiples puntos como miles', () => {
    expect(parseLooseNumber('1.234.567')).toBe(1234567);
    expect(parseLooseNumber('2.600.000')).toBe(2600000);
  });
  it('preserva el punto decimal real (1-2 dígitos detrás)', () => {
    expect(parseLooseNumber('1.5')).toBe(1.5);
    expect(parseLooseNumber('2.34')).toBe(2.34);
    expect(parseLooseNumber('850.50')).toBe(850.5);
  });
});

describe('parseLooseNumber — formato en-US y mixto', () => {
  it('coma como miles, punto decimal', () => {
    expect(parseLooseNumber('1,234.56')).toBe(1234.56);
    expect(parseLooseNumber('1,234,567')).toBe(1234567);
  });
  it('punto como miles, coma decimal (1.234,56)', () => {
    expect(parseLooseNumber('1.234,56')).toBe(1234.56);
  });
  it('coma sola decimal', () => {
    expect(parseLooseNumber('2,34')).toBe(2.34);
    expect(parseLooseNumber('1,5')).toBe(1.5);
  });
});

describe('parseLooseNumber — bordes', () => {
  it('quita símbolos de moneda y espacios', () => {
    expect(parseLooseNumber('$ 2.600')).toBe(2600);
    expect(parseLooseNumber('USD 4.100')).toBe(4100);
  });
  it('maneja negativos y paréntesis contables', () => {
    expect(parseLooseNumber('-1.500')).toBe(-1500);
    expect(parseLooseNumber('(2.000)')).toBe(-2000);
  });
  it('vacío / no numérico → 0', () => {
    expect(parseLooseNumber('')).toBe(0);
    expect(parseLooseNumber(null)).toBe(0);
    expect(parseLooseNumber('   ')).toBe(0);
    expect(parseLooseNumber('abc')).toBe(0);
  });
});

describe('parseDelimited', () => {
  it('detecta tab (pegado de Excel) y parsea filas', () => {
    const t = 'REF-001\tPerfil\t1200\tkg\n REF-002\tÁngulo\t800\tkg';
    const { rows, delimiter } = parseDelimited(t);
    expect(delimiter).toBe('\t');
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('REF-001');
    expect(rows[1][2]).toBe('800');
  });
  it('respeta comillas con comas internas', () => {
    const t = 'ref,desc,fob\nREF-1,"Perfil 40, blanco",3120';
    const { rows } = parseDelimited(t);
    expect(rows[1][1]).toBe('Perfil 40, blanco');
    expect(rows[1][2]).toBe('3120');
  });
  it('ignora filas totalmente vacías', () => {
    const { rows } = parseDelimited('a,b\n\n,\nc,d');
    expect(rows).toHaveLength(2);
  });
});
