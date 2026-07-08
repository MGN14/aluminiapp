import { describe, it, expect } from 'vitest';
import { guessField, guessMapping, isSummaryReference, hasAnyData, makeCellNumberParser } from './packingListParse';
import { parseLooseNumber } from './delimitedParser';

// Encabezados EXACTOS del formato definitivo de proforma (Cowork, jul 2026).
const PROFORMA_HEADER = ['REF.', 'Kg/m', 'Descripcion', 'Color', 'UND', 'KG'];

describe('guessMapping — formato proforma definitivo', () => {
  it('mapea REF./UND/KG bien, captura Color y descarta Kg/m', () => {
    expect(guessMapping(PROFORMA_HEADER, 6)).toEqual([
      'reference',   // REF.
      'ignorar',     // Kg/m — peso POR METRO, no total
      'descripcion', // Descripcion
      'color',       // Color — se conserva (las refs se repiten por color)
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
      'reference',            // Items
      'descripcion',          // Descripcion
      'ignorar',              // MM
      'ignorar',              // KG/M — peso por metro
      'ignorar',              // m
      'color',                // Color
      'bultos',               // Bales — total del contenedor = control de descarga
      'cantidad',             // UNDS
      'peso_kg',              // KG
      'ignorar',              // USD/TON — precio por tonelada, no FOB del renglón
      'fob_total_usd',        // Usd — el FOB real
      'ignorar',              // Mercancia (COP prorrateado)
      'ignorar',              // Flete
      'ignorar',              // Arancel — la app estima + el real de la declaración manda
      'ignorar',              // IVA — ídem
      'ignorar',              // Aduanas — ídem
      'ignorar',              // Transporte
      'costo_unitario_excel', // Costo Unitario — se guarda para comparar vs landed
      'ignorar',              // Utilidad
      'ignorar',              // Precio Final ('precio' matchearía FOB, pero Usd ya lo tomó)
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

describe('makeCellNumberParser — xlsx estricto vs CSV/pegado heurístico', () => {
  it('REGRESIÓN numeric overflow: el flotante de Excel no se interpreta como miles', () => {
    // El peso real del Maple: 123.90282000000001 kg. La heurística es-CO lo
    // convertía en 12.390.282.000.000.001 → overflow de numeric(14,3) en la BD.
    const strict = makeCellNumberParser(true, parseLooseNumber);
    expect(strict('123.90282000000001')).toBeCloseTo(123.90282, 5);
    expect(strict('536.6231134200001')).toBeCloseTo(536.62311, 5);
    expect(strict('2041')).toBe(2041);
    expect(strict('')).toBe(0);
    // Texto no canónico dentro de un xlsx cae al parser flexible.
    expect(strict('$ 1.234,56')).toBeCloseTo(1234.56, 2);
  });

  it('CSV/pegado conserva la heurística es-CO (3.120 = tres mil ciento veinte)', () => {
    const loose = makeCellNumberParser(false, parseLooseNumber);
    expect(loose('3.120')).toBe(3120);
    expect(loose('1.234,56')).toBeCloseTo(1234.56, 2);
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
