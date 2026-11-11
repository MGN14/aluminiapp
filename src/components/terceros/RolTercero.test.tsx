/**
 * Smoke test del chip de rol editable: se abre con un clic SIN navegar la
 * fila (el listado navega a la ficha al hacer clic en la fila), marca Cliente,
 * guarda y llama a saveRolesTercero; "Volver a automático" guarda null.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RolEditable } from './RolTercero';

const saveMock = vi.fn();
vi.mock('@/lib/terceroProfile', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/terceroProfile')>();
  return { ...real, saveRolesTercero: (...args: unknown[]) => saveMock(...args) };
});

beforeAll(() => {
  // jsdom no trae ResizeObserver y el Popper de Radix lo usa.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
beforeEach(() => saveMock.mockReset());

function montar(props: Partial<Parameters<typeof RolEditable>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const filaClick = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <table><tbody><tr onClick={filaClick}><td>
        <RolEditable terceroId="t-1" nombre="Vidrimar" roles={['proveedor']} derivados={['proveedor']} manual={false} {...props} />
      </td></tr></tbody></table>
    </QueryClientProvider>,
  );
  return { filaClick };
}

describe('RolEditable — cambiar el rol con un clic', () => {
  it('abre sin navegar la fila, marca Cliente, desmarca Proveedor y guarda', async () => {
    saveMock.mockResolvedValue(['cliente']);
    const { filaClick } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar el rol de Vidrimar' }));
    expect(filaClick).not.toHaveBeenCalled();
    expect(screen.getByText('Rol de Vidrimar')).toBeTruthy();
    expect(screen.getByText('Automático: Proveedor')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Cliente/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Proveedor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(filaClick).not.toHaveBeenCalled();

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith('t-1', ['cliente']));
  });

  it('con rol fijado a mano ofrece "Volver a automático", que guarda null', async () => {
    saveMock.mockResolvedValue(null);
    montar({ roles: ['cliente'], manual: true });

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar el rol de Vidrimar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a automático' }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith('t-1', null));
  });

  it('sin cambios no deja guardar', () => {
    montar({ roles: ['cliente'], manual: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar el rol de Vidrimar' }));
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
