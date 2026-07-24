import { describe, it, expect } from 'vitest';
import { suggestReferences, levenshtein } from './refSuggest';

const MAESTRO = ['38X38-3', '38X38-2', 'LIV-38', 'LIV-38-2', 'DIA09', 'DIA09-2', 'MN1103', 'BLJY011'];

describe('suggestReferences', () => {
  it('la misma referencia escrita distinto matchea exacto (distancia 0)', () => {
    expect(suggestReferences('38*38-3', MAESTRO)).toEqual([{ reference: '38X38-3', distancia: 0 }]);
  });

  it('corrige un typo de un carácter', () => {
    const s = suggestReferences('38X38-33', MAESTRO);
    expect(s[0].reference).toBe('38X38-3');
  });

  it('referencia incompleta sugiere las que empiezan igual', () => {
    const refs = suggestReferences('DIA0', MAESTRO).map((s) => s.reference);
    expect(refs).toContain('DIA09');
    expect(refs).toContain('DIA09-2');
  });

  it('si matchea exacto no hay nada que corregir (única sugerencia)', () => {
    expect(suggestReferences('DIA09', MAESTRO)).toEqual([{ reference: 'DIA09', distancia: 0 }]);
  });

  it('una referencia de 1-2 letras NO inventa sugerencia', () => {
    expect(suggestReferences('B', MAESTRO)).toEqual([]);
    expect(suggestReferences('XY', MAESTRO)).toEqual([]);
  });

  it('no sugiere nada cuando de verdad no se parece', () => {
    expect(suggestReferences('ZZZZ999', MAESTRO)).toEqual([]);
  });

  it('levenshtein básico', () => {
    expect(levenshtein('casa', 'casa')).toBe(0);
    expect(levenshtein('casa', 'caza')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
