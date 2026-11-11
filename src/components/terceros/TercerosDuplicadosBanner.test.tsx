/**
 * La unión de terceros no se puede deshacer: esta prueba fija QUIÉN absorbe a
 * quién en el caso Polyacril (la ficha provisional se va, Polyacril queda) y
 * que "Mejor conservar…" invierte el sentido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TercerosDuplicadosBanner from './TercerosDuplicadosBanner';

const { rpc, fetchAllPaged } = vi.hoisted(() => ({ rpc: vi.fn(), fetchAllPaged: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc, from: () => ({}) } }));
vi.mock('@/lib/fetchAllPaged', () => ({ fetchAllPaged }));

const terceros = [
  { id: 'e2f4', name: 'Polyacril', nit: null },
  { id: '9a2d', name: 'Cliente NIT 901317432', nit: '901317432' },
  { id: 'x', name: 'Distrialum', nit: '800190383' },
];
const actividad = new Map([['e2f4', 30], ['9a2d', 2], ['x', 10]]);

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TercerosDuplicadosBanner terceros={terceros} actividad={actividad} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  fetchAllPaged.mockReset()
    .mockResolvedValueOnce([                                     // aliases
      { responsible_id: 'e2f4', alias: 'POLYACRIL COMMERCE S.A.S' },
      { responsible_id: '9a2d', alias: 'Cliente NIT 901317432' },
    ])
    .mockResolvedValueOnce([                                     // facturas
      { responsible_id: 'e2f4', counterparty_name: 'POLYACRIL COMMERCE S.A.S' },
      { responsible_id: '9a2d', counterparty_name: 'POLYACRIL COMMERCE S.A.S' },
    ]);
  // En este entorno de pruebas localStorage puede venir incompleto (sin clear).
  try { localStorage.removeItem('aluminia_terceros_no_son_el_mismo_v1'); } catch { /* sin storage */ }
});

describe('TercerosDuplicadosBanner — unir fichas del mismo tercero', () => {
  it('propone el par Polyacril y, al unir, la ficha provisional es la que se absorbe', async () => {
    montar();
    expect(await screen.findByText('Cliente NIT 901317432')).toBeTruthy();
    expect(screen.getByText(/un alias de «Polyacril»/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Unir/ }));
    const dialogo = await screen.findByRole('alertdialog');
    expect(within(dialogo).getByText('Unir «Cliente NIT 901317432» dentro de «Polyacril»')).toBeTruthy();
    expect(within(dialogo).getByText('No se puede deshacer.')).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole('button', { name: /^Unir$/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('merge_responsibles', { p_legacy_id: '9a2d', p_canonical_id: 'e2f4' }));
  });

  it('"Mejor conservar…" invierte quién queda', async () => {
    montar();
    await screen.findByText('Cliente NIT 901317432');
    fireEvent.click(screen.getByRole('button', { name: /Unir/ }));
    const dialogo = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialogo).getByText(/Mejor conservar «Cliente NIT 901317432»/));
    expect(within(dialogo).getByText('Unir «Polyacril» dentro de «Cliente NIT 901317432»')).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole('button', { name: /^Unir$/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('merge_responsibles', { p_legacy_id: 'e2f4', p_canonical_id: '9a2d' }));
  });

  it('"No son el mismo" lo saca de la lista y no llama a la base', async () => {
    montar();
    await screen.findByText('Cliente NIT 901317432');
    fireEvent.click(screen.getByText('No son el mismo'));
    await waitFor(() => expect(screen.queryByText('Cliente NIT 901317432')).toBeNull());
    expect(rpc).not.toHaveBeenCalled();
  });
});
