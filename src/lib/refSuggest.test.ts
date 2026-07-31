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

// ── Caso real jul 2026: bodega escribe MN, Siigo escribe MGN ────────────────
// Lina despachó "MN91-3" y el maestro tiene "MGN91-5" (Riel Closet). Salía
// como "sin parecido en el maestro" aunque el producto existiera con stock.
describe('prefijo de letras distinto, mismo numero', () => {
  const maestro = ['MGN91-5', 'MN-92-5', 'MN315-5', 'MN43-5', 'MN4546-5', 'JXMN1101-5'];

  it('MN91-3 encuentra MGN91-5', () => {
    const s = suggestReferences('MN91-3', maestro);
    expect(s[0]?.reference).toBe('MGN91-5');
  });

  it('NO sugiere MN-92-5 para MN91-3: es otro producto', () => {
    const s = suggestReferences('MN91-3', maestro);
    expect(s.some((x) => x.reference === 'MN-92-5')).toBe(false);
  });

  it('MN1103 encuentra MGN1103-5 (mismo patron documentado en product_aliases)', () => {
    const s = suggestReferences('MN1103', ['MGN1103-5', 'MGN1104-5']);
    expect(s[0]?.reference).toBe('MGN1103-5');
    expect(s.some((x) => x.reference === 'MGN1104-5')).toBe(false);
  });

  it('el numero manda: prefijo igual pero numero distinto no cruza', () => {
    const s = suggestReferences('MGN91-3', ['MGN92-5']);
    expect(s.some((x) => x.reference === 'MGN92-5')).toBe(false);
  });

  it('dos letras de diferencia no alcanza (evita inventar)', () => {
    const s = suggestReferences('XYZ91-3', ['MGN91-5']);
    expect(s.some((x) => x.reference === 'MGN91-5')).toBe(false);
  });

  it('la coincidencia exacta sigue mandando sobre el patron', () => {
    const s = suggestReferences('MGN91', ['MGN91-5', 'MN91-5']);
    expect(s[0]?.reference).toBe('MGN91-5');
  });
});
