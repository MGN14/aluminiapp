import { describe, it, expect } from 'vitest';
import { parseMaestra } from './useInventoryVariants';

// Formato REAL del conteo de bodega de Nico (jul 2026): REF | DESCRIPCION |
// COLOR | UND — encabezados cortos ("REF", "UND") y color en columna.
const CONTEO = [
  ['REF', 'DESCRIPCION ', 'COLOR ', 'UND'],
  ['ALN173B', 'Sillar Cabezal Liv', 'Mate', '87'],
  ['LIV-36', 'Sillar Liviano 744', 'Mate', '260'],
  ['LIV-36', 'Sillar Liviano 744', 'Negro', '66'],
  ['T116', 'Tubo 116', 'Crudo', '478'],
  ['ALN177B', 'Pisavidrio Plano Liv', 'Blanco', '40'],
  ['', '', '', ''],
  ['TOTAL', '', '', '931'],
];

describe('parseMaestra — conteo de bodega (REF/COLOR/UND)', () => {
  it('mapea color a sufijo según la convención y salta totales/vacíos', () => {
    const { data, error } = parseMaestra(CONTEO);
    expect(error).toBeNull();
    const byRef = new Map(data.map(d => [d.reference, d]));
    expect(byRef.get('ALN173B')?.stock).toBe(87);      // Mate = base
    expect(byRef.get('LIV-36')?.stock).toBe(260);      // mate
    expect(byRef.get('LIV-36-3')?.stock).toBe(66);     // negro
    expect(byRef.get('T116-0')?.stock).toBe(478);      // crudo
    expect(byRef.get('ALN177B-2')?.stock).toBe(40);    // blanco
    expect(byRef.has('TOTAL')).toBe(false);
    expect(data).toHaveLength(5);
  });

  it('agrega filas repetidas de la misma variante (upsert no revienta)', () => {
    const { data } = parseMaestra([
      ['Referencia', 'Stock'],
      ['LIV-40', '10'],
      ['LIV-40', '5'],
    ]);
    expect(data).toHaveLength(1);
    expect(data[0].stock).toBe(15);
  });

  it('sigue leyendo el formato maestra formal (Referencia/Stock inicial/Costo)', () => {
    const { data, error } = parseMaestra([
      ['Referencia', 'Nombre', 'Stock inicial', 'Costo'],
      ['LIV-40-5', 'Liviano 40', '1.200', '21.500'],
    ]);
    expect(error).toBeNull();
    expect(data[0]).toMatchObject({ reference: 'LIV-40-5', stock: 1200, cost: 21500 });
  });
});
