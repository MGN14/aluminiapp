import { describe, expect, it } from 'vitest';
import { missingCatalogReferences } from './remisionCatalog';

const line = (reference: string, product_name = '', units = 1) => ({ reference, product_name, units });

describe('referencias de remisiones para el Maestro', () => {
  it('respeta los códigos existentes y los alias y distingue variantes de color', () => {
    const result = missingCatalogReferences(
      [line('38*38-2'), line('REF10'), line('38 × 38-3', 'Negro'), line('38X38-3', 'Duplicado')],
      ['38x38-2'],
      ['ref10'],
    );
    expect(result).toEqual({ candidates: [{ reference: '38X38-3', name: 'Negro' }], omitted: [] });
  });

  it('deja los totales y códigos dudosos para revisión y omite cantidades no válidas', () => {
    const result = missingCatalogReferences(
      [line('LIV-40-5'), line('FLETE-1'), line('Texto libre'), line('A30', '', 0), line('A40', '', NaN), line('A50', '  Perfil  ')],
      [],
      [],
    );
    expect(result.candidates).toEqual([{ reference: 'A50', name: 'Perfil' }]);
    expect(result.omitted).toEqual(expect.arrayContaining(['FLETE-1', 'LIV-40-5', 'Texto libre']));
  });
});
