import { describe, it, expect } from 'vitest';
import { refFamilyKey, suffixColorConflict, normalizeColor } from './refFamily';

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

describe('suffixColorConflict — proforma (sin sufijo) vs packing list (con sufijo)', () => {
  it('proforma: ref base + cualquier color = válido (China no maneja sufijos)', () => {
    expect(suffixColorConflict('LIV-40', 'Mate')).toBeNull();
    expect(suffixColorConflict('LIV-40', 'Negro')).toBeNull();
    expect(suffixColorConflict('T077A', 'Blanco')).toBeNull();
  });

  it('packing list: sufijo y color coincidentes = válido', () => {
    expect(suffixColorConflict('LIV-40-3', 'Negro')).toBeNull();
    expect(suffixColorConflict('LIV-40-2', 'Blanco')).toBeNull();
    expect(suffixColorConflict('LIV-40-0', 'Crudo')).toBeNull();
    expect(suffixColorConflict('LIV-40-3', 'NEGRO ')).toBeNull(); // case/espacios
  });

  it('packing list: sufijo contradiciendo la columna Color = error visible', () => {
    expect(suffixColorConflict('LIV-40-3', 'Blanco')).toContain('sufijo dice "negro"');
    expect(suffixColorConflict('LIV-40-2', 'Crudo')).toContain('sufijo dice "blanco"');
  });

  it('sufijo con columna Color vacía = válido (el sufijo manda)', () => {
    expect(suffixColorConflict('LIV-40-3', null)).toBeNull();
    expect(suffixColorConflict('LIV-40-3', '')).toBeNull();
  });

  it('un renglón físico con -5 (el total) genera aviso', () => {
    expect(suffixColorConflict('LIV-40-5', 'Mate')).toContain('-5');
  });

  it('colores no estándar no explotan (se conservan, sin falso conflicto sin sufijo)', () => {
    expect(suffixColorConflict('LIV-40', 'Champagne')).toBeNull();
    expect(normalizeColor('Champagne')).toBe('champagne');
  });
});
