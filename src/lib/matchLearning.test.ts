import { describe, it, expect } from 'vitest';
import { extraerAliasAprendible } from './matchLearning';

describe('extraerAliasAprendible', () => {
  it('extrae el fragmento identificable de un pago PSE', () => {
    expect(extraerAliasAprendible('PAGO PSE ALUMINIOS JH SAS', 'Aluminios del Eje'))
      .toBe('aluminios jh');
  });

  it('las transferencias genéricas no dejan nada aprendible', () => {
    expect(extraerAliasAprendible('TRANSFERENCIA CTA SUC VIRTUAL', 'Todoalum')).toBeNull();
    expect(extraerAliasAprendible('TRANSFERENCIA NEQUI 3104567890', 'Vidrios Soto')).toBeNull();
    expect(extraerAliasAprendible('CONSIGNACION 00123456', 'Ferromendez')).toBeNull();
  });

  it('si el nombre del cliente ya está en la descripción, no aprende (el scorer ya lo veía)', () => {
    expect(extraerAliasAprendible('TRANSF DE VIDRIOS SOTO', 'Vidrios Soto')).toBeNull();
  });

  it('si un alias existente ya cubre el fragmento, no duplica', () => {
    expect(extraerAliasAprendible('PAGO PSE ALUMINIOS JH', 'Aluminios del Eje', ['aluminios jh sas']))
      .toBeNull();
  });

  it('quita tildes, números y puntuación antes de comparar', () => {
    expect(extraerAliasAprendible('ABONO INTERBANCARIA GÓMEZ & RAMÍREZ 4432', 'GR Distribuciones'))
      .toBe('gomez ramirez');
  });

  it('descripción vacía o solo números → null', () => {
    expect(extraerAliasAprendible('', 'X')).toBeNull();
    expect(extraerAliasAprendible('12345 678', 'X')).toBeNull();
    expect(extraerAliasAprendible(null, 'X')).toBeNull();
  });

  it('un tipo societario suelto no es un alias', () => {
    expect(extraerAliasAprendible('PAGO PSE SAS', 'Cliente')).toBeNull();
  });
});
