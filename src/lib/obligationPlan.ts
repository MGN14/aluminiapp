/**
 * De un patrón de pago detectado en la conciliación → las obligaciones fijas
 * que hay que crear ("Sí, es fijo" en el Dashboard).
 *
 * Reporte Nico 2026-09-16: las obligaciones creadas desde patrones salían con
 * el día de la PROYECCIÓN (último pago + frecuencia → 17, 18, 20), un solo mes
 * cuando la frecuencia no era mensual (la nómina quincenal desaparecía al mes
 * siguiente), tipo "Otro", y duplicaban obligaciones manuales con la misma
 * plata y fecha (MiPlanilla vs "Nómina — Compensar"). Acá se decide con los
 * pagos REALES: día típico (mediana), quincenal = dos filas (15 y 30), meses
 * según la frecuencia, tipo según la categoría.
 */
import type { BusinessObligationTipo } from '@/hooks/useBusinessObligations';

export interface PatternTx {
  date: string; // YYYY-MM-DD
  amount: number; // valor absoluto
}

export interface PatternLike {
  description: string;
  estimated_amount: number;
  estimated_date: string; // YYYY-MM-DD
  frequency_days: number;
  occurrences: number;
}

export interface ObligationPlan {
  nombre: string;
  tipo: BusinessObligationTipo;
  dia_mes: number;
  monto_estimado: number;
  meses: string[];
  notas: string;
}

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const ALL_MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** Quincenal: pagos cada ~15 días (dos veces al mes). */
export const isQuincenal = (frequencyDays: number) => frequencyDays >= 12 && frequencyDays <= 20;

/** Tipo de obligación según el prefijo de la categoría ("Nómina — Angie"). */
export function inferTipo(description: string): BusinessObligationTipo {
  const d = norm(description);
  if (/\b(pila|planilla|compensar|seguridad social)\b/.test(d)) return 'pila';
  if (/^(nomina|salario|sueldo)\b/.test(d)) return 'nomina';
  if (/^(arriendo|alquiler)\b/.test(d)) return 'arriendo';
  if (/^servicios?\b/.test(d)) return 'servicios';
  if (/^parafiscal/.test(d)) return 'parafiscales';
  if (/^cesantia/.test(d)) return 'cesantias';
  return 'otro';
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const dayOf = (iso: string) => Number(iso.slice(8, 10)) || 1;
const clampDay = (d: number) => Math.max(1, Math.min(31, Math.round(d)));

/** Meses en los que cae la obligación según la frecuencia: hasta ~45 días es
 *  todos los meses; más largo, cada N meses a partir del próximo estimado. */
export function mesesFromFrequency(frequencyDays: number, estimatedDate: string): string[] {
  if (frequencyDays <= 45) return ALL_MONTHS;
  const stride = Math.max(2, Math.round(frequencyDays / 30));
  const start = (Number(estimatedDate.slice(5, 7)) || 1) - 1; // 0-based
  const out: string[] = [];
  for (let k = 0; k < 12; k += stride) out.push(String(((start + k) % 12) + 1));
  return out.sort((a, b) => Number(a) - Number(b));
}

/**
 * Filas a crear. Con los pagos reales del patrón (últimos meses) decide el
 * día y el monto típicos; sin pagos, cae a la proyección del patrón.
 */
export function planObligationsFromPattern(p: PatternLike, txs: PatternTx[]): ObligationPlan[] {
  const tipo = inferTipo(p.description);
  const base = p.description.substring(0, 100);
  const notas = `Creada desde patrón detectado (${p.occurrences} pagos, cada ~${p.frequency_days}d).`;

  if (isQuincenal(p.frequency_days)) {
    // Dos filas: primera quincena (días ≤ 22) y segunda (días > 22).
    const a = txs.filter((t) => dayOf(t.date) <= 22);
    const b = txs.filter((t) => dayOf(t.date) > 22);
    const diaA = a.length ? clampDay(median(a.map((t) => dayOf(t.date)))) : 15;
    const diaB = b.length ? Math.min(30, clampDay(median(b.map((t) => dayOf(t.date))))) : 30;
    const montoA = a.length ? median(a.map((t) => t.amount)) : p.estimated_amount;
    const montoB = b.length ? median(b.map((t) => t.amount)) : p.estimated_amount;
    return [
      { nombre: `${base} (1ª quincena)`, tipo, dia_mes: diaA, monto_estimado: Math.round(montoA), meses: ALL_MONTHS, notas: `${notas} Quincenal.` },
      { nombre: `${base} (2ª quincena)`, tipo, dia_mes: diaB, monto_estimado: Math.round(montoB), meses: ALL_MONTHS, notas: `${notas} Quincenal.` },
    ];
  }

  const dia = txs.length >= 2 ? clampDay(median(txs.map((t) => dayOf(t.date)))) : clampDay(dayOf(p.estimated_date));
  const monto = txs.length ? median(txs.map((t) => t.amount)) : p.estimated_amount;
  return [{
    nombre: base,
    tipo,
    dia_mes: Math.min(dia, 30),
    monto_estimado: Math.round(monto),
    meses: mesesFromFrequency(p.frequency_days, p.estimated_date),
    notas,
  }];
}

/** Distancia circular entre días del mes (el 30 y el 2 están a 3 días). */
const dayDistance = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d);
};

/**
 * ¿El patrón ya está cubierto por una obligación manual? Por nombre parecido
 * (como siempre) o por misma plata (±25%) y fecha cercana (±7 días) — el caso
 * "MiPlanilla" (manual, día 15, $2.8M) vs "Nómina — Compensar" (patrón, día
 * 18, $2.6M): mismo pago con otro nombre.
 */
export function coveredByManualObligation(
  p: { description: string; estimated_amount: number; estimated_date: string },
  manual: Array<{ nombre: string; dia_mes: number; monto_estimado: number | null }>,
): boolean {
  const d = norm(p.description);
  const day = dayOf(p.estimated_date);
  return manual.some((o) => {
    const n = norm(o.nombre);
    if (n && (d.includes(n) || n.includes(d))) return true;
    const monto = Number(o.monto_estimado ?? 0);
    if (monto <= 0 || p.estimated_amount <= 0) return false;
    const rel = Math.abs(monto - p.estimated_amount) / Math.max(monto, p.estimated_amount);
    return rel <= 0.25 && dayDistance(day, o.dia_mes) <= 7;
  });
}
