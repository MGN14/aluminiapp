/**
 * Qué hacer cuando la conexión con Siigo queda en 'error'.
 *
 * Caso real (2026-11-12): a las 2:08 p. m. la sincronización funcionó; a las
 * 2:56 p. m. el /auth de Siigo devolvió un 403 con una página HTML (bloqueo
 * pasajero de su firewall, no clave mala) y la edge function marcó
 * connection_status='error'. Como el auto-sync solo corría con 'connected',
 * nadie volvió a intentar: la app quedó sin traer ventas hasta que alguien
 * tocó "Traer de Siigo" a mano, y en Ajustes solo se veía el HTML crudo.
 *
 * Regla: un error de CLAVE (400/401: usuario o access key rechazados) no se
 * reintenta solo — reintentar con una clave mala no la arregla y puede hacer
 * que Siigo bloquee la cuenta. Todo lo demás (403/429/5xx, red) es pasajero:
 * se reintenta solo con la clave guardada.
 */

export type TipoErrorSiigo = 'clave' | 'pasajero';

/** Las edge functions guardan `auth <status>: <cuerpo>` cuando falla el /auth. */
export function clasificarErrorSiigo(lastError: string | null | undefined): TipoErrorSiigo {
  const m = /^auth (\d{3})\b/.exec(lastError ?? '');
  if (m && (m[1] === '400' || m[1] === '401')) return 'clave';
  return 'pasajero';
}

/** Explicación en español para Ajustes, en vez del HTML crudo de Siigo. */
export function mensajeErrorSiigo(lastError: string | null | undefined): string {
  if (!lastError) return '';
  const m = /^auth (\d{3})\b/.exec(lastError);
  if (!m) return lastError.slice(0, 200);
  if (clasificarErrorSiigo(lastError) === 'clave') {
    return `Siigo no aceptó el usuario o la access key (error ${m[1]}). Revisalos y volvé a conectar.`;
  }
  return `Siigo rechazó la conexión por un momento (error ${m[1]}). Suele ser pasajero: la app reintenta sola con la clave guardada, o tocá "Reintentar".`;
}

/** Espera mínima desde el último error antes de reintentar solo. */
export const ESPERA_REINTENTO_MS = 30 * 60 * 1000;

/**
 * ¿El auto-sync debe reintentar aunque el estado diga 'error'?
 * `updatedAt` = cuándo se escribió el error (updated_at de la fila).
 */
export function debeReintentarSiigo(
  c: { estado: string | null | undefined; lastError: string | null | undefined; updatedAt: string | null | undefined },
  ahoraMs: number,
  esperaMs = ESPERA_REINTENTO_MS,
): boolean {
  if (c.estado !== 'error') return false;
  if (clasificarErrorSiigo(c.lastError) === 'clave') return false;
  const t = c.updatedAt ? new Date(c.updatedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return true;
  return ahoraMs - t >= esperaMs;
}
