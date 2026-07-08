import { describe, it, expect } from 'vitest';
import { refFamilyKey } from './refFamily';

// Referencias REALES de la maestra de inventario y de los packing lists.
describe('refFamilyKey', () => {
  it('la -5 de Siigo y la base del packing list caen en la misma familia', () => {
    expect(refFamilyKey('LIV-40-5')).toBe('liv-40');
    expect(refFamilyKey('LIV-40')).toBe('liv-40');
    expect(refFamilyKey('T077A-5')).toBe('t077a');
    expect(refFamilyKey('T077A')).toBe('t077a');
    expect(refFamilyKey('ALN177B-5')).toBe('aln177b');
  });

  it('los sufijos de color conforman la misma familia', () => {
    expect(refFamilyKey('LIV-40-0')).toBe('liv-40'); // crudo
    expect(refFamilyKey('LIV-40-2')).toBe('liv-40'); // blanco
    expect(refFamilyKey('LIV-40-3')).toBe('liv-40'); // negro
    expect(refFamilyKey('MGN17-2')).toBe('mgn17');   // fila real de Siigo
  });

  it('solo pela UN sufijo, el último', () => {
    expect(refFamilyKey('MN-46-5')).toBe('mn-46');
    expect(refFamilyKey('SAL-343-5')).toBe('sal-343');
    expect(refFamilyKey('ART-403-5')).toBe('art-403');
  });

  it('refs sin sufijo de color quedan intactas', () => {
    expect(refFamilyKey('MGN11-1')).toBe('mgn11-1'); // -1 no es sufijo de color
    expect(refFamilyKey('100X44-5')).toBe('100x44');
    expect(refFamilyKey('744-100')).toBe('744-100');
    expect(refFamilyKey('Transpo')).toBe('transpo');
  });

  it('las NOUSAR no se mezclan con la referencia buena', () => {
    expect(refFamilyKey('T116-5NOUSAR')).not.toBe(refFamilyKey('T116-5'));
    expect(refFamilyKey('ALN343-5NNOUSAR')).not.toBe(refFamilyKey('ALN343-5'));
  });

  it('normaliza espacios y mayúsculas', () => {
    expect(refFamilyKey('  liv-40-5 ')).toBe('liv-40');
    expect(refFamilyKey(null)).toBe('');
  });
});
