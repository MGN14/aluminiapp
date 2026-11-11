/**
 * Trae TODAS las filas de una consulta paginando de a 1.000.
 *
 * PostgREST corta cada respuesta en 1.000 filas EN SILENCIO (200 OK, sin
 * aviso), y un `.limit(10000)` del cliente no levanta ese tope. Ya cortó el
 * ledger de variantes (2026-08-01) y la cartera (auditoría H5); en
 * Conciliación el año 2026 llegó a 941 filas en noviembre — la tabla de
 * movimientos estaba a un extracto de perder las filas MÁS NUEVAS sin decir
 * nada (auditoría 2026-11-11).
 *
 * `build(desde, hasta)` debe devolver la consulta YA con `.range(desde, hasta)`
 * y con un orden ESTABLE (terminando en una columna única, ej. `id`): sin
 * desempate, dos páginas pueden repetir o saltarse filas con la misma fecha.
 *
 * `maxRows` acota historiales que no necesitan toda la vida (ej. los últimos
 * 10.000 movimientos clasificados); sin él, trae todo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Respuesta = PromiseLike<{ data: any; error: any }>;

export const PAGE_SIZE = 1000;

export async function fetchAllPaged<T>(
  build: (from: number, to: number) => Respuesta,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<T[]> {
  const page = Math.max(1, opts?.pageSize ?? PAGE_SIZE);
  const max = opts?.maxRows ?? Number.POSITIVE_INFINITY;
  const out: T[] = [];
  for (let from = 0; from < max; from += page) {
    const to = Math.min(from + page, max) - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < to - from + 1) break; // página incompleta = se acabó
  }
  return out;
}
