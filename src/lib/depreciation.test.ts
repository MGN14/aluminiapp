import { describe, it, expect } from 'vitest';
import { computeDepreciation } from './depreciation';

describe('computeDepreciation', () => {
  it('línea recta: maquinaria 120M, 10 años, 24 meses transcurridos', () => {
    const r = computeDepreciation(
      { valor_compra: 120_000_000, fecha_compra: '2024-06-15', vida_util_meses: 120, valor_residual: 0 },
      new Date('2026-06-15'),
    );
    expect(r.mesesTranscurridos).toBe(24);
    expect(r.depMensual).toBe(1_000_000);          // 120M / 120
    expect(r.depAcumulada).toBe(24_000_000);
    expect(r.valorEnLibros).toBe(96_000_000);
    expect(r.totalmenteDepreciado).toBe(false);
  });

  it('respeta el valor residual (piso del valor en libros)', () => {
    const r = computeDepreciation(
      { valor_compra: 50_000_000, fecha_compra: '2020-01-01', vida_util_meses: 60, valor_residual: 5_000_000 },
      new Date('2030-01-01'), // muy pasado → totalmente depreciado
    );
    expect(r.depreciableBase).toBe(45_000_000);
    expect(r.depAcumulada).toBe(45_000_000);       // no más que la base depreciable
    expect(r.valorEnLibros).toBe(5_000_000);       // queda el residual
    expect(r.totalmenteDepreciado).toBe(true);
  });

  it('no deprecia más allá de la vida útil', () => {
    const r = computeDepreciation(
      { valor_compra: 60_000_000, fecha_compra: '2018-01-01', vida_util_meses: 60, valor_residual: 0 },
      new Date('2026-01-01'), // 96 meses brutos, vida 60
    );
    expect(r.mesesTranscurridos).toBe(60);
    expect(r.valorEnLibros).toBe(0);
  });

  it('activo recién comprado: sin depreciación todavía', () => {
    const r = computeDepreciation(
      { valor_compra: 10_000_000, fecha_compra: '2026-06-01', vida_util_meses: 60, valor_residual: 0 },
      new Date('2026-06-15'),
    );
    expect(r.mesesTranscurridos).toBe(0);
    expect(r.depAcumulada).toBe(0);
    expect(r.valorEnLibros).toBe(10_000_000);
  });

  it('convención de mes: cuenta meses completos desde el mes de compra (ignora el día)', () => {
    // comprado 31-ene, asOf 1-feb → 1 mes (cruza el límite de mes por 1 día)
    const a = computeDepreciation({ valor_compra: 12_000_000, fecha_compra: '2024-01-31', vida_util_meses: 12, valor_residual: 0 }, new Date(2024, 1, 1));
    expect(a.mesesTranscurridos).toBe(1);
    // comprado 1-ene, asOf 31-ene → 0 meses (mismo mes)
    const b = computeDepreciation({ valor_compra: 12_000_000, fecha_compra: '2024-01-01', vida_util_meses: 12, valor_residual: 0 }, new Date(2024, 0, 31));
    expect(b.mesesTranscurridos).toBe(0);
  });

  it('fecha de compra futura → 0 meses, sin depreciación', () => {
    const r = computeDepreciation({ valor_compra: 10_000_000, fecha_compra: '2027-01-01', vida_util_meses: 60, valor_residual: 0 }, new Date(2026, 5, 1));
    expect(r.mesesTranscurridos).toBe(0);
    expect(r.valorEnLibros).toBe(10_000_000);
  });

  it('residual > costo → base 0, no deprecia (valor en libros = costo)', () => {
    const r = computeDepreciation({ valor_compra: 10_000_000, fecha_compra: '2024-01-01', vida_util_meses: 60, valor_residual: 50_000_000 }, new Date(2026, 0, 1));
    expect(r.depreciableBase).toBe(0);
    expect(r.depAcumulada).toBe(0);
    expect(r.valorEnLibros).toBe(10_000_000);
  });

  it('depreciación del año en curso (comprado año anterior)', () => {
    const r = computeDepreciation(
      { valor_compra: 120_000_000, fecha_compra: '2025-01-01', vida_util_meses: 120, valor_residual: 0 },
      new Date(2026, 5, 1), // junio 2026 (constructor local, sin desfase UTC)
    );
    // dep mensual 1M; a junio 2026 lleva 17 meses; del año 2026 cayeron 5 meses (ene-may)
    expect(r.depAnioActual).toBe(5_000_000);
  });
});
