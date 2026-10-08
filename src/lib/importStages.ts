/**
 * Duración de etapas de una importación a partir de import_estado_history.
 *
 * Cada fila del historial dice cuándo la importación ENTRÓ a un estado.
 * La duración de la etapa X = fecha de entrada al siguiente estado registrado
 * − fecha de entrada a X. Para el estado actual (sin siguiente), la etapa
 * "va corriendo" contra hoy.
 */

import { IMPORT_ESTADOS_ORDER, type ImportEstado } from '@/hooks/useImports';

export interface EstadoHistoryEntry {
  estado: ImportEstado | string;
  fecha: string; // YYYY-MM-DD
}

export interface StageDuration {
  estado: ImportEstado;
  desde: string;
  hasta: string | null; // null = etapa en curso
  dias: number;
  enCurso: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Etapas con duración, en orden de flujo. Ignora 'cancelado'. */
export function computeStageDurations(
  history: EstadoHistoryEntry[],
  estadoActual: string,
): StageDuration[] {
  const fechas = new Map<string, string>();
  for (const h of history) fechas.set(h.estado, h.fecha);

  // Regla de flujo: fechas de etapas POSTERIORES al estado actual no cuentan
  // (fila huérfana de 'entregado' con el pedido aún en tránsito congelaba la
  // etapa en curso y el total). Para cancelado/legacy (fuera del flujo) se
  // toma todo el historial.
  const idxActual = IMPORT_ESTADOS_ORDER.indexOf(estadoActual as ImportEstado);
  const enFlujo = IMPORT_ESTADOS_ORDER.filter(
    (e, i) => fechas.has(e) && (idxActual === -1 || i <= idxActual),
  );
  if (!enFlujo.length) return [];

  const cerrada = estadoActual === 'entregado' || estadoActual === 'cerrado' || estadoActual === 'cancelado';
  const out: StageDuration[] = [];
  for (let i = 0; i < enFlujo.length; i++) {
    const estado = enFlujo[i];
    const desde = fechas.get(estado)!;
    const siguiente = i + 1 < enFlujo.length ? fechas.get(enFlujo[i + 1])! : null;
    if (siguiente) {
      out.push({ estado, desde, hasta: siguiente, dias: Math.max(0, daysBetween(desde, siguiente)), enCurso: false });
    } else if (estado === 'entregado' || cerrada) {
      // Última etapa de una importación cerrada: no corre más.
      out.push({ estado, desde, hasta: desde, dias: 0, enCurso: false });
    } else {
      out.push({ estado, desde, hasta: null, dias: Math.max(0, daysBetween(desde, todayIso())), enCurso: true });
    }
  }
  return out;
}

/** Días totales de la importación: desde que se MONTÓ el pedido (producción)
 *  → entregado (o hoy si sigue abierta). La cotización NO cuenta — es tiempo
 *  de decisión, no de abastecimiento (decisión de Nico, 2026-07-24). Fallback
 *  a la fecha de cotización solo si es la única registrada (legacy). */
export function computeTotalDays(
  history: EstadoHistoryEntry[],
  estadoActual: string,
): { dias: number; enCurso: boolean } | null {
  if (!history.length) return null;
  const sinCancelado = history.filter(h => h.estado !== 'cancelado');
  const fechasFlujo = sinCancelado
    .filter(h => h.estado !== 'cotizacion')
    .map(h => h.fecha)
    .sort();
  const fechasTodas = sinCancelado.map(h => h.fecha).sort();
  const inicio = fechasFlujo[0] ?? fechasTodas[0];
  if (!inicio) return null;
  // La fecha de 'entregado' solo cierra el total si el pedido REALMENTE está
  // entregado (o cancelado) — regla de flujo, ver computeStageDurations.
  const entregado = (estadoActual === 'entregado' || estadoActual === 'cerrado' || estadoActual === 'cancelado')
    ? history.find(h => h.estado === 'entregado')?.fecha
    : undefined;
  if (entregado) return { dias: Math.max(0, daysBetween(inicio, entregado)), enCurso: false };
  if (estadoActual === 'cancelado') return null;
  return { dias: Math.max(0, daysBetween(inicio, todayIso())), enCurso: true };
}

/** Promedio de días por etapa a través de varias importaciones (solo etapas cerradas). */
export function computeStageAverages(
  imports: { history: EstadoHistoryEntry[]; estado: string }[],
): Partial<Record<ImportEstado, { promedio: number; muestras: number }>> {
  const acc = new Map<ImportEstado, { total: number; n: number }>();
  for (const imp of imports) {
    for (const stage of computeStageDurations(imp.history, imp.estado)) {
      if (stage.enCurso) continue; // solo etapas terminadas cuentan al promedio
      if (stage.estado === 'entregado') continue;
      // La retención en fábrica (listo_fabrica → tránsito) es una DECISIÓN
      // del negocio, no una etapa del flujo: fuera de los promedios para no
      // contaminar el lead time (caso 2 contenedores simultáneos).
      if (stage.estado === 'listo_fabrica') continue;
      const a = acc.get(stage.estado) ?? { total: 0, n: 0 };
      a.total += stage.dias;
      a.n += 1;
      acc.set(stage.estado, a);
    }
  }
  const out: Partial<Record<ImportEstado, { promedio: number; muestras: number }>> = {};
  for (const [estado, { total, n }] of acc) {
    out[estado] = { promedio: Math.round(total / n), muestras: n };
  }
  return out;
}

/**
 * Fecha de ENTREGA de un contenedor, para ordenarlo entre los entregados y
 * saber cuál es "el último entregado".
 *
 *   1) la entrada a 'entregado' del historial (la buena)
 *   2) fecha_arribo_real (columna legacy que se llena al entregar)
 *   3) la ÚLTIMA etapa registrada antes de entregar: la entrega fue después,
 *      así que es una cota inferior que respeta el orden entre contenedores.
 *
 * Caso real (Nico 2026-10-08): 2026-2 quedó "entregado" sin fecha de entrega
 * (el modal borraba la que acababa de guardar) y los banners lo ordenaban por
 * su fecha de PRODUCCIÓN (junio) — quedaba antes que 2026-1 (entregado en
 * julio) y todo se seguía comparando contra 2026-1.
 */
export function fechaEntregaImport(r: {
  fecha_arribo_real?: string | null;
  import_estado_history?: EstadoHistoryEntry[] | null;
}): string | null {
  const hist = r.import_estado_history ?? [];
  const entregado = hist.find((h) => h.estado === 'entregado')?.fecha;
  if (entregado) return entregado;
  if (r.fecha_arribo_real) return r.fecha_arribo_real;
  const previas = hist
    .filter((h) => h.estado !== 'cerrado' && h.estado !== 'cancelado' && h.fecha)
    .map((h) => h.fecha)
    .sort();
  return previas.length ? previas[previas.length - 1] : null;
}

/** Entregados (o cerrados) ordenados por fecha de entrega, el más reciente al FINAL. */
export function ordenarEntregados<T extends {
  estado: string;
  fecha_arribo_real?: string | null;
  import_estado_history?: EstadoHistoryEntry[] | null;
}>(rows: T[]): T[] {
  return rows
    .filter((r) => r.estado === 'entregado' || r.estado === 'cerrado')
    .map((r) => ({ r, f: fechaEntregaImport(r) ?? '' }))
    .sort((a, b) => a.f.localeCompare(b.f))
    .map((x) => x.r);
}
