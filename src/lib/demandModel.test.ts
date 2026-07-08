import { describe, it, expect } from 'vitest';
import { computeFamilyDemand } from './demandModel';

const HOY = '2026-07-08';

describe('computeFamilyDemand — consumo censurado (idea de Nico)', () => {
  it('el caso LIV-40-5: vendió 500 en ~21 días y quedó seca → la tasa refleja los días CON stock', () => {
    // Contenedor entregó 500 el 2026-04-15; se vendieron en 3 tandas hasta
    // 2026-05-05 (21 días); desde ahí stock 0 hasta hoy (~64 días secos).
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 0,
      movimientos: [
        { tipo: 'entrada', quantity: 500, date: '2026-04-15' },
        { tipo: 'salida', quantity: 200, date: '2026-04-20' },
        { tipo: 'salida', quantity: 200, date: '2026-04-28' },
        { tipo: 'salida', quantity: 100, date: '2026-05-05' },
      ],
    });
    expect(d.salidasVentana).toBe(500);
    // Ingenuo: 500/90 ≈ 5,6 — subestima brutal.
    expect(d.consumoDiarioSimple).toBeCloseTo(5.56, 1);
    // Censurado: solo cuenta los ~21 días con stock → ~24/día.
    expect(d.diasConStock).toBeGreaterThan(15);
    expect(d.diasConStock).toBeLessThan(30);
    expect(d.consumoDiario).toBeGreaterThan(15);
  });

  it('referencia siempre con stock: censurado ≈ ingenuo', () => {
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 400,
      movimientos: [
        { tipo: 'salida', quantity: 90, date: '2026-05-01' },
        { tipo: 'salida', quantity: 90, date: '2026-06-01' },
        { tipo: 'salida', quantity: 90, date: '2026-07-01' },
      ],
    });
    expect(d.diasConStock).toBe(90);
    expect(d.consumoDiario).toBeCloseTo(d.consumoDiarioSimple, 5);
  });

  it('sin ventas → consumo 0 (no inventa demanda)', () => {
    const d = computeFamilyDemand({
      todayIso: HOY, ventanaDias: 90, stockActual: 100, movimientos: [],
    });
    expect(d.consumoDiario).toBe(0);
    expect(d.salidasVentana).toBe(0);
  });

  it('estacionalidad NEUTRA con poca historia (montada pero esperando)', () => {
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 100,
      movimientos: [
        { tipo: 'salida', quantity: 50, date: '2026-05-10' },
        { tipo: 'salida', quantity: 50, date: '2026-06-10' },
      ],
    });
    expect(d.estacionalidadActiva).toBe(false);
    expect(d.indiceEstacional).toBe(1);
    expect(d.mesesDeHistoria).toBeLessThan(12);
    expect(d.serieMensual).toEqual([
      { mes: '2026-05', salidas: 50 },
      { mes: '2026-06', salidas: 50 },
    ]);
  });

  it('estacionalidad ACTIVA con 12+ meses: el mes fuerte empuja el índice (acotado)', () => {
    // 13 meses de historia: agosto (mes objetivo desde el 8-jul) vende el doble.
    const movs = [] as { tipo: 'salida'; quantity: number; date: string }[];
    const meses = ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    for (const mes of meses) {
      movs.push({ tipo: 'salida', quantity: mes.endsWith('-08') ? 200 : 100, date: `${mes}-15` });
    }
    const d = computeFamilyDemand({
      todayIso: HOY, ventanaDias: 90, stockActual: 1000, movimientos: movs,
    });
    expect(d.estacionalidadActiva).toBe(true);
    expect(d.indiceEstacional).toBeGreaterThan(1.5); // agosto ≈ 200 / promedio ≈ 108
    expect(d.indiceEstacional).toBeLessThanOrEqual(1.8); // acotado
  });
});
