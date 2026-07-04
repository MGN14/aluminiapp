import { describe, it, expect } from 'vitest';
import { encodeLabelPayload, parseScan, normalizeRef, QR_PREFIX } from './qrLabel';

describe('encodeLabelPayload', () => {
  it('arma el payload básico ref+qty', () => {
    expect(encodeLabelPayload('744-100', 6)).toBe('ALU|744-100|6');
  });

  it('incluye ubicación y serial en posiciones fijas', () => {
    expect(encodeLabelPayload('SA325B', 40, 'A1', 'SA325B-0042')).toBe('ALU|SA325B|40|A1|SA325B-0042');
  });

  it('serial sin ubicación deja la posición de ubicación vacía', () => {
    expect(encodeLabelPayload('SA325B', 40, undefined, 'SA325B-0042')).toBe('ALU|SA325B|40||SA325B-0042');
  });

  it('reemplaza pipes en ref/ubicación/serial para no romper el parseo', () => {
    expect(encodeLabelPayload('A|B', 2, 'C|1', 'S|9')).toBe('ALU|A/B|2|C/1|S/9');
  });

  it('cantidad inválida cae a 1', () => {
    expect(encodeLabelPayload('X', 0)).toBe('ALU|X|1');
    expect(encodeLabelPayload('X', NaN)).toBe('ALU|X|1');
    expect(encodeLabelPayload('X', -5)).toBe('ALU|X|1');
  });
});

describe('parseScan — formatos válidos', () => {
  it('payload completo con ubicación y serial', () => {
    expect(parseScan('ALU|744-100|6|A1|744-100-0007')).toEqual({
      reference: '744-100', quantity: 6, location: 'A1', serial: '744-100-0007',
    });
  });

  it('sin ubicación (etiqueta vieja)', () => {
    expect(parseScan('ALU|744-100|6')).toEqual({ reference: '744-100', quantity: 6, location: undefined, serial: undefined });
  });

  it('serial con ubicación vacía (posición fija)', () => {
    const r = parseScan('ALU|SA325B|40||SA325B-0042');
    expect(r?.reference).toBe('SA325B');
    expect(r?.location).toBeUndefined();
    expect(r?.serial).toBe('SA325B-0042');
  });

  it('sin cantidad → 1', () => {
    expect(parseScan('ALU|744-100')?.quantity).toBe(1);
  });

  it('código pelado (fallback manual)', () => {
    expect(parseScan('744-100')).toEqual({ reference: '744-100', quantity: 1, location: undefined, serial: undefined });
  });

  it('ref|qty sin prefijo (etiqueta legacy)', () => {
    expect(parseScan('744-100|6')).toEqual({ reference: '744-100', quantity: 6, location: undefined, serial: undefined });
  });

  it('roundtrip encode → parse', () => {
    const r = parseScan(encodeLabelPayload('8025-300', 12, 'B4', '8025-300-0001'));
    expect(r).toEqual({ reference: '8025-300', quantity: 12, location: 'B4', serial: '8025-300-0001' });
  });
});

describe('parseScan — tolerancia a lecturas sucias', () => {
  it('prefijo en minúsculas / mezclado (CapsLock, layout raro)', () => {
    expect(parseScan('alu|744-100|6')?.reference).toBe('744-100');
    expect(parseScan('Alu|744-100|6')?.quantity).toBe(6);
  });

  it('espacios alrededor y dentro de las partes', () => {
    expect(parseScan('  ALU | 744-100 | 6 | A1 ')).toEqual({
      reference: '744-100', quantity: 6, location: 'A1', serial: undefined,
    });
  });

  it('identificador de simbología AIM antepuesto (]Q1 QR, ]C1 Code128)', () => {
    expect(parseScan(']Q1ALU|744-100|6')?.reference).toBe('744-100');
    expect(parseScan(']C1744-100|6')?.reference).toBe('744-100');
  });

  it('basura no alfanumérica antes del prefijo', () => {
    expect(parseScan('?ALU|744-100|6')?.reference).toBe('744-100');
    expect(parseScan('*#ALU|SA325B|40|A1')?.location).toBe('A1');
  });

  it('cantidad con coma decimal', () => {
    expect(parseScan('ALU|744-100|6,5')?.quantity).toBe(6.5);
  });

  it('cantidad ilegible cae a 1 (no NaN)', () => {
    expect(parseScan('ALU|744-100|abc')?.quantity).toBe(1);
    expect(parseScan('ALU|744-100|-4')?.quantity).toBe(1);
    expect(parseScan('ALU|744-100|0')?.quantity).toBe(1);
  });

  it('cantidad absurda (corrupción) cae a 1', () => {
    expect(parseScan('ALU|744-100|99999999')?.quantity).toBe(1);
  });
});

describe('parseScan — rechazos (mejor re-escanear que registrar basura)', () => {
  it('vacío / solo espacios / solo prefijo → null', () => {
    expect(parseScan('')).toBeNull();
    expect(parseScan('   ')).toBeNull();
    expect(parseScan('ALU')).toBeNull();
    expect(parseScan('ALU|')).toBeNull();
    expect(parseScan('ALU| |6')).toBeNull();
  });

  it('dos payloads pegados (se perdió el Enter entre escaneos) → null', () => {
    expect(parseScan('ALU|744-100|6ALU|744-100|6')).toBeNull();
    expect(parseScan('ALU|SA325B|40|A1|SA325B-0041ALU|SA325B|40|A1|SA325B-0042')).toBeNull();
  });

  it('prefijo corrupto con carácter alfanumérico pegado → null (ambiguo)', () => {
    expect(parseScan('XALU|744-100|6')).toBeNull();
    expect(parseScan('9ALU|744-100|6')).toBeNull();
  });

  it('una referencia que contiene ALU no se confunde con el prefijo', () => {
    expect(parseScan('ALUM-200')).toEqual({ reference: 'ALUM-200', quantity: 1, location: undefined, serial: undefined });
    expect(parseScan(`${QR_PREFIX}|ALUM-200|5`)?.reference).toBe('ALUM-200');
  });
});

describe('normalizeRef', () => {
  it('trim + lowercase', () => {
    expect(normalizeRef('  SA325B ')).toBe('sa325b');
    expect(normalizeRef('')).toBe('');
  });
});
