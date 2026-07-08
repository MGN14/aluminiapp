import { describe, it, expect } from 'vitest';
import { comparePackingVsProforma } from './packingCompare';

describe('comparePackingVsProforma — agrupación por familia (-5)', () => {
  it('proforma sin sufijos (varias filas por color) vs packing con sufijos: misma familia, suma y compara', () => {
    const proforma = [
      { reference: 'LIV-40', cantidad: 70, peso_kg: 108 },  // Mate
      { reference: 'LIV-40', cantidad: 30, peso_kg: 46 },   // Negro (misma ref, fila aparte)
      { reference: 'T077A', cantidad: 1300, peso_kg: 2041 },
    ];
    const packing = [
      { reference: 'LIV-40', cantidad: 72, peso_kg: 111 },   // mate sin sufijo
      { reference: 'LIV-40-3', cantidad: 25, peso_kg: 38 },  // negro con sufijo
      { reference: 'T077A', cantidad: 1300, peso_kg: 2041 },
    ];
    const r = comparePackingVsProforma(proforma, packing);

    const liv = r.familias.find((f) => f.familia === 'liv-40')!;
    expect(liv.proformaCant).toBe(100); // 70 + 30 sumadas
    expect(liv.packingCant).toBe(97);   // 72 + 25 sumadas (base + -3, misma familia)
    expect(liv.deltaCant).toBe(-3);
    expect(liv.estado).toBe('difiere');

    const t077 = r.familias.find((f) => f.familia === 't077a')!;
    expect(t077.estado).toBe('igual');

    expect(r.conDiferencia.map((f) => f.familia)).toEqual(['liv-40']);
    expect(r.totales.deltaCant).toBe(-3);
  });

  it('referencias solo en un lado quedan marcadas', () => {
    const r = comparePackingVsProforma(
      [{ reference: 'DIA11', cantidad: 100 }],
      [{ reference: 'MN315', cantidad: 50 }],
    );
    expect(r.familias.find((f) => f.familia === 'dia11')!.estado).toBe('solo_proforma');
    expect(r.familias.find((f) => f.familia === 'mn315')!.estado).toBe('solo_packing');
    expect(r.conDiferencia).toHaveLength(2);
  });

  it('ordena por diferencia absoluta descendente', () => {
    const r = comparePackingVsProforma(
      [
        { reference: 'A1', cantidad: 100 },
        { reference: 'B2X', cantidad: 100 },
      ],
      [
        { reference: 'A1', cantidad: 90 },   // Δ -10
        { reference: 'B2X', cantidad: 150 }, // Δ +50
      ],
    );
    expect(r.familias[0].familia).toBe('b2x');
  });

  it('el label prefiere la referencia con sufijo (más completa)', () => {
    const r = comparePackingVsProforma(
      [{ reference: 'LIV-40', cantidad: 10 }],
      [{ reference: 'LIV-40-3', cantidad: 10 }],
    );
    expect(r.familias[0].label).toBe('LIV-40-3');
    expect(r.familias[0].estado).toBe('igual');
  });
});
