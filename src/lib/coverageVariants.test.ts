import { describe, it, expect } from 'vitest';
import { buildCoverageVariants } from './coverageVariants';

const HOY = '2026-07-08';

describe('buildCoverageVariants — cobertura por color, no por -5', () => {
  it('remisiones con sufijo → demanda por color real; proforma reponiendo esa variante', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [
        { reference: 'LIV-40-2', units: 90, date: '2026-06-01' },  // blanco 1/día
        { reference: 'LIV-40-3', units: 180, date: '2026-06-10' }, // negro 2/día
      ],
      inventario: [
        { reference: 'LIV-40-2', stockPhysical: 50 },
        { reference: 'LIV-40-3', stockPhysical: 40 },
      ],
      transito: [
        // Proforma LIV-40 + Blanco ya convertida a LIV-40-2 aguas arriba
        { reference: 'LIV-40-2', cantidad: 100, fechaDisponible: '2026-08-01' },
      ],
    });

    const blanco = out.find((v) => v.key === 'liv-40-2')!;
    const negro = out.find((v) => v.key === 'liv-40-3')!;
    expect(blanco.color).toBe('blanco');
    expect(blanco.consumoDiario).toBeCloseTo(1, 5);
    expect(blanco.stock).toBe(50);
    expect(blanco.enTransito).toBe(100);
    expect(blanco.stockEstimado).toBe(false);
    expect(negro.color).toBe('negro');
    expect(negro.consumoDiario).toBeCloseTo(2, 5);
    expect(negro.enTransito).toBe(0);
    // Cobertura por variante: negro 40/2 = 20 días.
    expect(negro.diasCobertura).toBe(20);
  });

  it('stock solo en la -5 + demanda por colores → reparto proporcional marcado como estimado', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [
        { reference: 'LIV-40-2', units: 90, date: '2026-06-01' },  // 1/día
        { reference: 'LIV-40-3', units: 270, date: '2026-06-10' }, // 3/día
      ],
      inventario: [{ reference: 'LIV-40-5', stockPhysical: 400 }], // Siigo: solo la -5
      transito: [],
    });

    const blanco = out.find((v) => v.key === 'liv-40-2')!;
    const negro = out.find((v) => v.key === 'liv-40-3')!;
    // Reparto por mezcla de demanda: blanco 25% (100), negro 75% (300).
    expect(blanco.stock).toBeCloseTo(100, 5);
    expect(blanco.stockEstimado).toBe(true);
    expect(negro.stock).toBeCloseTo(300, 5);
    expect(negro.stockEstimado).toBe(true);
    // Cobertura igual para ambos (mismo pote, misma mezcla): 100 días.
    expect(blanco.diasCobertura).toBe(100);
    expect(negro.diasCobertura).toBe(100);
    // La fila -5 queda sin stock efectivo (todo repartido) y sin demanda propia.
    const total = out.find((v) => v.key === 'liv-40-5');
    expect(total?.sinConsumo).toBe(true);
  });

  it('remisiones en -5 (sin discriminar) → la demanda queda en esa fila: la tabla muestra la verdad', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [{ reference: 'LIV-40-5', units: 90, date: '2026-06-01' }],
      inventario: [{ reference: 'LIV-40-5', stockPhysical: 200 }],
      transito: [],
    });
    const total = out.find((v) => v.key === 'liv-40-5')!;
    expect(total.color).toBe('sin discriminar');
    expect(total.consumoDiario).toBeCloseTo(1, 5);
    expect(total.stock).toBe(200); // sin colores con demanda: no hay reparto
    expect(total.diasCobertura).toBe(200);
  });

  it('el factor de demanda familiar (censura × tendencia × estacionalidad) ajusta las variantes', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [{ reference: 'LIV-40-3', units: 90, date: '2026-06-01' }],
      inventario: [{ reference: 'LIV-40-3', stockPhysical: 100 }],
      transito: [],
      factorDemandaPorFamilia: new Map([['liv-40', 3]]), // ej: vendió en ⅓ de los días
    });
    expect(out.find((v) => v.key === 'liv-40-3')!.consumoDiario).toBeCloseTo(3, 5);
  });

  it('un factor <1 (demanda frenando) también pasa — sin piso artificial acá', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [{ reference: 'LIV-40-3', units: 90, date: '2026-06-01' }],
      inventario: [{ reference: 'LIV-40-3', stockPhysical: 100 }],
      transito: [],
      factorDemandaPorFamilia: new Map([['liv-40', 0.8]]), // tendencia a la baja
    });
    // El piso de la censura (≥1) se aplica aguas arriba en el hook; el factor
    // combinado puede quedar <1 si la tendencia/estacionalidad frenan.
    expect(out.find((v) => v.key === 'liv-40-3')!.consumoDiario).toBeCloseTo(0.8, 5);
  });
});
