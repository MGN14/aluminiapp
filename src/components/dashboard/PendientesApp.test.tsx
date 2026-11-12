/**
 * Smoke test de "Pendientes en la app": cada fila lleva a su pantalla y
 * "Posponer" esconde la fila SIN navegar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import PendientesApp from './PendientesApp';
import { construirRecordatorios } from '@/lib/recordatoriosApp';

const posponerMock = vi.fn();
let recs = construirRecordatorios({
  hoy: '2026-11-12',
  siigo: { estado: 'error' },
  ultimaVenta: '2026-10-27',
  ultimaCompra: '2026-11-09',
  extractos: [],
  extractosSilenciados: [],
  ultimoConteo: '2026-08-25',
  movimientosDesdeConteo: 508,
  cajaSinCerrar: { movimientos: 0, masViejo: null },
});
vi.mock('@/hooks/useRecordatoriosApp', () => ({
  useRecordatoriosApp: () => ({ recordatorios: recs, loading: false, posponer: posponerMock }),
}));

function Donde() {
  const loc = useLocation();
  return <p data-testid="ruta">{loc.pathname}{loc.search}{loc.hash}</p>;
}

function montar() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="*" element={<><PendientesApp /><Donde /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => posponerMock.mockReset());

describe('PendientesApp', () => {
  it('muestra los pendientes y el clic lleva a la pantalla donde se resuelve', () => {
    montar();
    expect(screen.getByText('Siigo desconectado')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Inventario sin contar desde el 25 ago'));
    expect(screen.getByTestId('ruta').textContent).toBe('/inventarios?tab=conteo');
  });

  it('posponer no navega', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Posponer 7 días: Siigo desconectado' }));
    expect(posponerMock).toHaveBeenCalledWith('siigo');
    expect(screen.getByTestId('ruta').textContent).toBe('/dashboard');
  });

  it('sin pendientes dice que estás al día', () => {
    recs = [];
    montar();
    expect(screen.getByText('Estás al día.')).toBeInTheDocument();
  });
});
