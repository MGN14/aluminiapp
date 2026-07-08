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

  it('sin muestra del mes objetivo → estacional neutro, pero la serie ya se acumula', () => {
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 100,
      movimientos: [
        { tipo: 'salida', quantity: 50, date: '2026-05-10' },
        { tipo: 'salida', quantity: 50, date: '2026-06-10' },
      ],
    });
    // El mes objetivo (agosto) no tiene muestra todavía → neutro.
    expect(d.estacionalidadActiva).toBe(false);
    expect(d.indiceEstacional).toBe(1);
    expect(d.estacionalidadMadura).toBe(false);
    expect(d.serieMensual).toEqual([
      { mes: '2026-05', salidas: 50 },
      { mes: '2026-06', salidas: 50 },
    ]);
  });

  it('estacionalidad ACTIVA desde el primer dato del mes objetivo, ponderada por madurez', () => {
    // 4 meses de historia con un agosto pasado fuerte NO existe aún; simulamos
    // historia corta que SÍ incluye agosto: abril-agosto 2025... usamos hoy
    // ficticio en jul-2026 con datos desde jun-2025 parcial (13 meses) abajo.
    // Acá: historia de 4 meses que incluye el mes objetivo (agosto 2025 no —
    // así que armamos hoy = 2025-07-08 con agosto? imposible). En cambio:
    // mes objetivo con muestra + poca madurez → señal amortiguada.
    const movs = [
      { tipo: 'salida' as const, quantity: 200, date: '2025-08-15' }, // agosto fuerte
      { tipo: 'salida' as const, quantity: 100, date: '2026-04-15' },
      { tipo: 'salida' as const, quantity: 100, date: '2026-05-15' },
      { tipo: 'salida' as const, quantity: 100, date: '2026-06-15' },
    ];
    const d = computeFamilyDemand({
      todayIso: HOY, ventanaDias: 90, stockActual: 1000, movimientos: movs,
    });
    expect(d.estacionalidadActiva).toBe(true);
    // Crudo: 200/125 = 1.6; madurez 11/12 → aplicado ≈ 1 + 0.6×0.92 ≈ 1.55
    expect(d.indiceEstacional).toBeGreaterThan(1.3);
    expect(d.indiceEstacional).toBeLessThan(1.6);
    expect(d.estacionalidadMadura).toBe(false); // aún no 12 meses
  });

  it('estacionalidad MADURA con 13 meses: señal al 100% (acotada)', () => {
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
    expect(d.estacionalidadMadura).toBe(true);
    expect(d.indiceEstacional).toBeGreaterThan(1.5); // agosto ≈ 200 / promedio ≈ 108
    expect(d.indiceEstacional).toBeLessThanOrEqual(1.8); // acotado
  });
});

describe('tendencia de corto plazo (escasez/mercado/regulación — planteo de Nico)', () => {
  it('demanda acelerando: últimos 30 días venden más que el promedio → índice >1', () => {
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 500,
      movimientos: [
        { tipo: 'salida', quantity: 30, date: '2026-04-20' },  // viejo: lento
        { tipo: 'salida', quantity: 30, date: '2026-05-20' },
        { tipo: 'salida', quantity: 120, date: '2026-06-25' }, // últimos 30d: caliente
        { tipo: 'salida', quantity: 120, date: '2026-07-05' },
      ],
    });
    expect(d.indiceTendencia).toBeGreaterThan(1.5);
    expect(d.indiceTendencia).toBeLessThanOrEqual(2.0); // acotado
    expect(d.factorDemanda).toBeGreaterThan(1.5);
  });

  it('demanda frenando: últimos 30 días con stock pero casi sin ventas → índice <1', () => {
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 500,
      movimientos: [
        { tipo: 'salida', quantity: 200, date: '2026-04-20' },
        { tipo: 'salida', quantity: 200, date: '2026-05-10' },
        { tipo: 'salida', quantity: 5, date: '2026-06-25' },
      ],
    });
    expect(d.indiceTendencia).toBeLessThan(0.8);
    expect(d.indiceTendencia).toBeGreaterThanOrEqual(0.5); // acotado
  });

  it('agotada los últimos 30 días → tendencia neutra (no hay señal, no castiga)', () => {
    const d = computeFamilyDemand({
      todayIso: HOY,
      ventanaDias: 90,
      stockActual: 0,
      movimientos: [
        { tipo: 'entrada', quantity: 400, date: '2026-04-10' },
        { tipo: 'salida', quantity: 400, date: '2026-05-15' }, // se agotó hace 54 días
      ],
    });
    expect(d.indiceTendencia).toBe(1);
  });
});
