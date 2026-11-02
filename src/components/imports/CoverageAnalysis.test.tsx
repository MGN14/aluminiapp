/**
 * Smoke test de la tabla de Cobertura con el pipeline por etapa: monta el
 * componente con variantes REALES (salidas de buildCoverageVariants, no
 * fixtures a mano) y verifica que las columnas nuevas pinten sin romperse.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoverageAnalysis from './CoverageAnalysis';

vi.mock('@/hooks/useReorderSuggestion', async () => {
  // Nada de nivel superior acá: vi.mock se hoistea por encima de las constantes.
  const HOY = '2026-07-08';
  const { buildCoverageVariants } = await import('@/lib/coverageVariants');
  const porVariante = buildCoverageVariants({
    todayIso: HOY,
    ventanaDias: 90,
    ventas: [
      { reference: 'GL4102', units: 900, date: '2026-06-20' },   // 10/día
      { reference: 'LIV-40-3', units: 180, date: '2026-06-10' }, // 2/día
    ],
    inventario: [
      { reference: 'GL4102', stockPhysical: 200 },
      { reference: 'LIV-40-3', stockPhysical: 40 },
    ],
    transito: [
      { reference: 'GL4102', cantidad: 100, fechaDisponible: '2026-07-20', etapa: 'embarcado', pedido: '2026-3' },
      { reference: 'GL4102', cantidad: 2000, fechaDisponible: '2026-08-15', etapa: 'fabrica', pedido: '2026-4' },
      { reference: 'LIV-40-3', cantidad: 300, fechaDisponible: '2026-07-25', etapa: 'embarcado', pedido: '2026-3' },
    ],
  });
  const sug = {
    fechaLimite: '2026-08-01', diasParaDecidir: 24, fechaQuiebreGrupal: '2026-11-10',
    refsGrupal: [], alertas: [], faltantes: [], huecos: [], criticos: [], porReferencia: porVariante,
    llegadaSiPidoHoy: '2026-10-01',
    leadTime: {
      produccion: { dias: 32, fuente: 'medido', n: 2 },
      transito: { dias: 36, fuente: 'medido', n: 2 },
      nacionalizacion: { dias: 17, fuente: 'medido', n: 2 },
      totalDias: 85, tieneDefaults: false,
    },
    safetyDias: 15, umbralRefs: 3,
    datos: { referenciasConConsumo: 2, ventanaDias: 90, llegadasEnTransito: 3 },
    motivoSinFecha: null,
  };
  return {
    useReorderSuggestion: () => ({
      isPending: false,
      suggestion: sug,
      pedidosSinItems: [],
      pipeline: { produccion: 1, aduana: 0, transito: 1, total: 2, undsEmbarcadas: 400, undsFabrica: 2000 },
      kgPorUnidad: new Map(),
      kgPorUnidadVariante: new Map([['gl4102', 0.5]]),
      cicloPedidoDias: 34,
      diasCotizacion: 14,
      retenidos: [],
      disponibilidadPorImport: new Map(),
      referenciasSinCruzar: [],
      transitoSinImputar: [],
      demandPorFamilia: new Map(),
      porVariante,
      merma: null,
      ultimaLlegadaPorVariante: new Map([
        ['liv-40-3', { key: 'liv-40-3', importId: 'b', pedido: '2026-2', fechaEntrega: '2026-03-15', unidades: 1200, vendidas: 900, pctVendido: 75, diasDesdeEntrega: 115 }],
      ]),
    }),
  };
});

describe('CoverageAnalysis — pipeline por etapa en la tabla', () => {
  it('pinta Embarcado / En fábrica / Solo embarcado / Último llegado con los datos del motor', () => {
    render(<CoverageAnalysis />);

    // Encabezados nuevos (también aparecen en el pie explicativo → getAll).
    expect(screen.getAllByText('Embarcado').length).toBeGreaterThan(0);
    expect(screen.getAllByText('En fábrica').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Solo embarcado').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Último llegado').length).toBeGreaterThan(0);

    // GL4102: 100 embarcadas, 2.000 en fábrica; con todo 238d, solo embarcado 30d → depende de fábrica.
    expect(screen.getByText('+100')).toBeTruthy();
    expect(screen.getByText('+2.000')).toBeTruthy();
    expect(screen.getByText('238d')).toBeTruthy();
    expect(screen.getByText(/^30d/)).toBeTruthy();
    expect(screen.getByText(/1 ref depende de fábrica/)).toBeTruthy();

    // LIV-40-3: último llegado 1.200 und en 2026-2, vendido 900 (75%).
    expect(screen.getByText(/vendido 900 \(75%\)/)).toBeTruthy();
    expect(screen.getByText(/1\.200 · 15/)).toBeTruthy();

    // Resumen del pipeline en la cabecera.
    expect(screen.getByText(/und embarcadas/)).toBeTruthy();
  });
});
