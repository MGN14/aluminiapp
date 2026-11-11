import { describe, it, expect, vi } from 'vitest';
import { fetchAllPaged } from './fetchAllPaged';

/** Simula el servidor: devuelve como mucho `tope` filas por pedido (el corte silencioso). */
const servidor = (total: number, tope = 1000) => {
  const filas = Array.from({ length: total }, (_, i) => ({ id: i }));
  return vi.fn((from: number, to: number) =>
    Promise.resolve({ data: filas.slice(from, Math.min(to + 1, from + tope)), error: null }));
};

describe('fetchAllPaged — el tope silencioso de 1.000 filas', () => {
  it('trae todo aunque pase de 1.000 (el caso de Conciliación: 1.028 filas)', async () => {
    const build = servidor(1028);
    const rows = await fetchAllPaged<{ id: number }>(build);
    expect(rows).toHaveLength(1028);
    expect(rows[1027].id).toBe(1027);               // la MÁS NUEVA también llega
    expect(build).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenNthCalledWith(1, 0, 999);
    expect(build).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('con menos de una página hace un solo pedido', async () => {
    const build = servidor(941);
    expect(await fetchAllPaged(build)).toHaveLength(941);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('un múltiplo exacto de la página pide una más y termina vacío (no se queda corto)', async () => {
    const build = servidor(2000);
    expect(await fetchAllPaged(build)).toHaveLength(2000);
    expect(build).toHaveBeenCalledTimes(3);
  });

  it('maxRows acota el total y el último pedido no se pasa', async () => {
    const build = servidor(12_000);
    const rows = await fetchAllPaged(build, { maxRows: 2500 });
    expect(rows).toHaveLength(2500);
    expect(build).toHaveBeenLastCalledWith(2000, 2499);
  });

  it('propaga el error de cualquier página (nada de datos a medias)', async () => {
    const build = vi.fn((from: number) => from === 0
      ? Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
      : Promise.resolve({ data: null, error: new Error('timeout') }));
    await expect(fetchAllPaged(build)).rejects.toThrow('timeout');
  });

  it('data null sin error = cero filas', async () => {
    expect(await fetchAllPaged(() => Promise.resolve({ data: null, error: null }))).toEqual([]);
  });
});
