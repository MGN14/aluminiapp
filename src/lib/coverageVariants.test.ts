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

describe('cobertura "solo embarcado" — lo que sigue en fábrica no cuenta', () => {
  it('descuenta los lotes de fábrica y marca la dependencia cuando sin ellos quiebra pronto', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [{ reference: 'GL4102', units: 900, date: '2026-06-20' }], // 10/día
      inventario: [{ reference: 'GL4102', stockPhysical: 200 }],         // 20 días solo
      transito: [
        { reference: 'GL4102', cantidad: 100, fechaDisponible: '2026-07-20', etapa: 'embarcado', pedido: '2026-3' },
        { reference: 'GL4102', cantidad: 2000, fechaDisponible: '2026-08-15', etapa: 'fabrica', pedido: '2026-4' },
      ],
    });
    const v = out.find((x) => x.key === 'gl4102')!;
    // Con todo: 200 + 100 + 2000 → mucho más de 45 días.
    expect(v.diasCobertura).toBe(238);
    // Solo embarcado: al 20-jul quedan 200 − 120 + 100 = 180 → 18 días más → 30.
    expect(v.diasCoberturaEmbarcado).toBe(30);
    expect(v.fechaQuiebreEmbarcado).toBe('2026-08-07');
    expect(v.dependeDeFabrica).toBe(true);
    expect(v.enEmbarcado).toBe(100);
    expect(v.enFabrica).toBe(2000);
    expect(v.enTransito).toBe(2100);
  });

  it('sin lotes de fábrica, "solo embarcado" = cobertura total y no depende de nadie', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [{ reference: 'GL4102', units: 900, date: '2026-06-20' }],
      inventario: [{ reference: 'GL4102', stockPhysical: 200 }],
      transito: [{ reference: 'GL4102', cantidad: 100, fechaDisponible: '2026-07-20', etapa: 'embarcado' }],
    });
    const v = out.find((x) => x.key === 'gl4102')!;
    expect(v.diasCoberturaEmbarcado).toBe(v.diasCobertura);
    expect(v.dependeDeFabrica).toBe(false);
  });

  it('si con todo también quiebra pronto, no es "dependencia de fábrica": es faltante', () => {
    const out = buildCoverageVariants({
      todayIso: HOY,
      ventanaDias: 90,
      ventas: [{ reference: 'GL4102', units: 900, date: '2026-06-20' }], // 10/día
      inventario: [{ reference: 'GL4102', stockPhysical: 50 }],          // 5 días
      transito: [{ reference: 'GL4102', cantidad: 100, fechaDisponible: '2026-07-20', etapa: 'fabrica' }], // llega poco: 10 días más
    });
    const v = out.find((x) => x.key === 'gl4102')!;
    // Hueco del 13-jul al 20-jul y agote final el 30-jul: 22 días con todo.
    expect(v.diasCobertura).toBe(22);
    expect(v.diasCoberturaEmbarcado).toBe(5);
    expect(v.dependeDeFabrica).toBe(false);
  });
});
