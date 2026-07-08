import { describe, it, expect } from 'vitest';
import { guessField, guessMapping, isSummaryReference, hasAnyData } from './packingListParse';

// Encabezados EXACTOS del formato definitivo de proforma (Cowork, jul 2026).
const PROFORMA_HEADER = ['REF.', 'Kg/m', 'Descripcion', 'Color', 'UND', 'KG'];

describe('guessMapping — formato proforma definitivo', () => {
  it('mapea REF./UND/KG bien y descarta Kg/m y Color', () => {
    expect(guessMapping(PROFORMA_HEADER, 6)).toEqual([
      'reference',   // REF.
      'ignorar',     // Kg/m — peso POR METRO, no total
      'descripcion', // Descripcion
      'ignorar',     // Color
      'cantidad',    // UND = unidades
      'peso_kg',     // KG = peso total del renglón
    ]);
  });

  it('cada campo va a una sola columna: la primera gana, repetidas se ignoran', () => {
    expect(guessMapping(['REF', 'CODIGO', 'KG', 'PESO'], 4)).toEqual([
      'reference', 'ignorar', 'peso_kg', 'ignorar',
    ]);
  });

  it('sigue soportando el formato clásico de packing list', () => {
    expect(guessMapping(['Item', 'Description', 'Qty', 'Unit', 'Net weight', 'FOB Amount'], 6)).toEqual([
      'reference', 'descripcion', 'cantidad', 'unidad', 'peso_kg', 'fob_total_usd',
    ]);
  });

  it('mapea el costeo Maple: Usd es el FOB, no USD/TON ni Precio Final', () => {
    // Encabezados EXACTOS de la hoja "Maple" del costeo de contenedor de Nico.
    const MAPLE = ['Items', 'Descripcion', 'MM', 'KG/M', 'm', 'Color', 'Bales', 'UNDS', 'KG',
      'USD/TON', 'Usd', 'Mercancia', 'Flete', 'Arancel', 'IVA', 'Aduanas', 'Transporte',
      'Costo Unitario', 'Utilidad', 'Precio Final'];
    expect(guessMapping(MAPLE, MAPLE.length)).toEqual([
      'reference',     // Items
      'descripcion',   // Descripcion
      'ignorar',       // MM
      'ignorar',       // KG/M — peso por metro
      'ignorar',       // m
      'ignorar',       // Color
      'ignorar',       // Bales
      'cantidad',      // UNDS
      'peso_kg',       // KG
      'ignorar',       // USD/TON — precio por tonelada, no FOB del renglón
      'fob_total_usd', // Usd — el FOB real
      'ignorar',       // Mercancia (COP prorrateado)
      'ignorar',       // Flete
      'ignorar',       // Arancel
      'ignorar',       // IVA
      'ignorar',       // Aduanas
      'ignorar',       // Transporte
      'ignorar',       // Costo Unitario ("unitario" contiene "unit" — no es unidad)
      'ignorar',       // Utilidad
      'ignorar',       // Precio Final ('precio' matchearía FOB, pero Usd ya lo tomó)
    ]);
  });
});

describe('guessField — casos puntuales', () => {
  it('UND y UNDS son cantidad, "unidad" sigue siendo unidad', () => {
    expect(guessField('UND')).toBe('cantidad');
    expect(guessField('Unds')).toBe('cantidad');
    expect(guessField('unidad')).toBe('unidad');
  });
  it('Kg/m y kg/und se ignoran; KG es peso', () => {
    expect(guessField('Kg/m')).toBe('ignorar');
    expect(guessField('KG/und')).toBe('ignorar');
    expect(guessField('KG')).toBe('peso_kg');
  });
});

describe('filtrado de filas de resumen y notas al pie', () => {
  it('la fila TOTAL se detecta aunque tenga números', () => {
    expect(isSummaryReference('TOTAL')).toBe(true);
    expect(isSummaryReference('Subtotal')).toBe(true);
    expect(isSummaryReference('TOTALES')).toBe(true);
  });
  it('referencias reales no se confunden con totales', () => {
    expect(isSummaryReference('T077A')).toBe(false);
    expect(isSummaryReference('LIV-40-5')).toBe(false);
    // "TOT..." como prefijo de ref real no matchea el \b
    expect(isSummaryReference('TOTA-15')).toBe(false);
  });
  it('notas al pie sin datos numéricos se filtran por hasAnyData', () => {
    expect(hasAnyData({ cantidad: 0, peso_kg: null, fob_total_usd: 0 })).toBe(false); // "Tope contenedor: 28.400 kg"
    expect(hasAnyData({ cantidad: 1300, peso_kg: 2041, fob_total_usd: 0 })).toBe(true); // T077A
    expect(hasAnyData({ cantidad: 0, peso_kg: null, fob_total_usd: 500 })).toBe(true); // solo FOB también vale
  });
});
