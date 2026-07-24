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

/** Días totales de la importación: primer estado registrado → entregado (o hoy si sigue abierta). */
export function computeTotalDays(
  history: EstadoHistoryEntry[],
  estadoActual: string,
): { dias: number; enCurso: boolean } | null {
  if (!history.length) return null;
  const fechas = history
    .filter(h => h.estado !== 'cancelado')
    .map(h => h.fecha)
    .sort();
  if (!fechas.length) return null;
  const inicio = fechas[0];
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
