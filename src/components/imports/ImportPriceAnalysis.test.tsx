/**
 * Smoke test de Análisis de precios con lotes reales y proyectados: el hook
 * se mockea con el resultado de las MISMAS libs (buildRefCostSeries +
 * computeCostoProyectado), así la pantalla se prueba con la forma real.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImportPriceAnalysis from './ImportPriceAnalysis';

vi.mock('@/hooks/usePrecioProyectado', async () => {
  const { buildRefCostSeries, computeCostoProyectado } = await import('@/lib/costoProyectado');
  const base = {
    key: 'liv-40-3', reference: 'LIV-40-3', descripcion: 'Perfil ventana', created_at: '2026-01-01',
    proveedor: 'Shandong', smm_usd_ton: 2500, peso_kg: 50, fob_total_usd: 200, landed_por_kg_cop: null,
    delta_unit_pct: null, fob_usd_kg: 4, prima_smm_usd_ton: 1500, costosEstimados: false,
  };
  const series = buildRefCostSeries([
    { ...base, import_id: 'a', pedido: '2026-1', estado: 'entregado', proyectado: false, fecha: '2026-03-01', trm: 4000, trmEstimada: false, cantidad: 100, landed_unit_cop: 1000 },
    { ...base, import_id: 'b', pedido: '2026-2', estado: 'entregado', proyectado: false, fecha: '2026-07-15', trm: 3900, trmEstimada: false, cantidad: 300, landed_unit_cop: 1100 },
    { ...base, import_id: 'c', pedido: '2026-3', estado: 'transito', proyectado: true, fecha: '2026-11-20', trm: 4100, trmEstimada: true, costosEstimados: true, cantidad: 100, landed_unit_cop: 1320 },
  ]);
  const { refs, kpis } = computeCostoProyectado(series.map((s) => ({
    key: s.key, familia: 'liv-40', reference: s.reference, color: 'negro', descripcion: s.descripcion,
    stockActual: 100, costoActual: 1100, costoActualFuente: 'variante' as const,
    lotes: s.points, precioLista: 1500,
  })), { ivaIncluido: false });
  return {
    usePrecioProyectado: () => ({
      isLoading: false, series, refs, kpis,
      supuestos: { trmHoy: 4100, abiertosProyectados: 1, abiertosSinTrm: 0, abiertosCostosEstimados: 1, moldeLabel: '2026-2', moldeCostosPorKg: 1250 },
      costoFuente: 'variante', ivaIncluido: false, toggleIva: vi.fn(), trmHoy: 4100,
    }),
  };
});

describe('ImportPriceAnalysis — real, proyectado y costo del inventario', () => {
  it('pinta KPIs, la fila con costo proyectado y margen, y el detalle lote a lote al abrir', () => {
    render(<ImportPriceAnalysis />);

    // KPIs nuevos y supuestos declarados.
    expect(screen.getByText('Lo que viene vs lo que tengo')).toBeTruthy();
    expect(screen.getByText('Margen a lista de hoy')).toBeTruthy();
    expect(screen.getByText(/TRM de hoy \$4\.100/)).toBeTruthy();
    expect(screen.getByText(/estructura de 2026-2/)).toBeTruthy();

    // Fila: en camino 1.320 vs último real 1.100 → +20%; costo proyectado (100×1100 + 100×1320)/200 = 1.210.
    expect(screen.getByText('LIV-40-3')).toBeTruthy();
    expect(screen.getAllByText('+20.0%').length).toBeGreaterThan(0);
    expect(screen.getByText(/\$\s?1\.210/)).toBeTruthy();
    // Margen: (1500 − 1100)/1500 = 26,7% → (1500 − 1210)/1500 = 19,3%
    expect(screen.getAllByText('26,7%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('19,3%').length).toBeGreaterThan(0);
    // Chip de etapa y marca de estimado.
    expect(screen.getAllByText(/tránsito/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('est.').length).toBeGreaterThan(0);

    // Abrir la fila → detalle lote a lote con la TRM "hoy" marcada.
    fireEvent.click(screen.getByText('LIV-40-3'));
    expect(screen.getByText('Landed unit.')).toBeTruthy();
    expect(screen.getByText('hoy')).toBeTruthy();
    expect(screen.getByText('2026-3')).toBeTruthy();
  });
});
