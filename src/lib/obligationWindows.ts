/**
 * Ventanas de la tarjeta "Próximas obligaciones" del Dashboard.
 * Pedido de Nico (2026-10-22): "ese dato de 'en 45 días' no me sirve de
 * nada; hazlo por 'este mes tenés esta obligación' y 'en los próximos 7 días'".
 * Funciones puras (reciben `hoy`) para poder probarlas sin tocar el reloj.
 */

export const DIAS_SEMANA = 7;

const DIA_MS = 86_400_000;

/**
 * Días calendario hasta `fecha` (0 = vence hoy, negativo = vencida).
 * Se compara mediodía contra mediodía para que "Hoy" dure el día entero:
 * con la resta cruda de milisegundos, a las 9 am una obligación de hoy decía
 * "Mañana" y al día siguiente a las 9 am todavía decía "Hoy".
 */
export function diasRestantes(fecha: Date, hoy: Date = new Date()): number {
  const a = new Date(hoy);
  a.setHours(12, 0, 0, 0);
  const b = new Date(fecha);
  b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DIA_MS);
}

export function enEsteMes(fecha: Date, hoy: Date = new Date()): boolean {
  return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth();
}

/** Suma solo montos conocidos y positivos (una ETA de importación no es plata). */
export function sumaMontos(items: Array<{ monto?: number | null }>): number {
  return items.reduce((s, it) => s + (it.monto && it.monto > 0 ? it.monto : 0), 0);
}

export interface VentanasObligaciones<T> {
  /** Vencidas y sin marcar como pagadas, de cualquier mes. */
  vencidas: T[];
  /** Vencen entre hoy y dentro de 7 días (vencidas aparte). */
  semana: T[];
  /** Todo lo del mes calendario en curso, incluidas las ya vencidas del mes. */
  mes: T[];
  /** Lo que muestra la tarjeta: vencidas + semana + mes, por fecha ascendente. */
  lista: T[];
}

/**
 * Reparte las obligaciones pendientes en las ventanas de la tarjeta. Recibe
 * solo las NO pagadas (el caller filtra con isPaid) para que la plata del
 * encabezado coincida con las filas.
 */
export function ventanasObligaciones<T extends { fecha: Date }>(items: T[], hoy: Date = new Date()): VentanasObligaciones<T> {
  const conDias = items.map(ev => ({ ev, d: diasRestantes(ev.fecha, hoy), mes: enEsteMes(ev.fecha, hoy) }));
  const porFecha = (a: { ev: T }, b: { ev: T }) => a.ev.fecha.getTime() - b.ev.fecha.getTime();
  return {
    vencidas: conDias.filter(x => x.d < 0).sort(porFecha).map(x => x.ev),
    semana: conDias.filter(x => x.d >= 0 && x.d <= DIAS_SEMANA).sort(porFecha).map(x => x.ev),
    mes: conDias.filter(x => x.mes).sort(porFecha).map(x => x.ev),
    lista: conDias.filter(x => x.d < 0 || x.d <= DIAS_SEMANA || x.mes).sort(porFecha).map(x => x.ev),
  };
}
