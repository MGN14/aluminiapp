/**
 * Detección de vacíos (gaps) de días entre extractos bancarios.
 *
 * Caso real: Nico descargó movimientos "20/05 a 01/06" y después "08/06 a 02/07"
 * → los días 02/06 a 07/06 quedaron sin datos y nadie se dio cuenta hasta que
 * los números no cuadraron. Esta función detecta esos huecos para alertar en
 * la página de Extractos.
 *
 * Agrupamos por bank_name solamente (no por account_number): el cierre mensual
 * PDF y los CSV semanales de la misma cuenta pueden diferir en cómo reportan la
 * cuenta, y partir la serie generaría falsos positivos. La tarjeta de crédito
 * ya viene con bank_name propio ("Tarjeta de crédito Bancolombia") así que no
 * se mezcla con la cuenta.
 */

export interface StatementPeriodLike {
  bank_name: string | null;
  period_start: string | null; // YYYY-MM-DD
  period_end: string | null;   // YYYY-MM-DD
}

export interface CoverageGap {
  bank: string;
  /** Primer día SIN datos (YYYY-MM-DD) */
  from: string;
  /** Último día SIN datos (YYYY-MM-DD) */
  to: string;
  days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function findCoverageGaps(statements: StatementPeriodLike[]): CoverageGap[] {
  // Solo extractos con período conocido (los viejos sin period_start/end no
  // aportan señal y generarían ruido).
  const byBank = new Map<string, { start: number; end: number }[]>();
  for (const s of statements) {
    if (!s.period_start || !s.period_end) continue;
    const bank = s.bank_name || 'Banco';
    const start = toUTC(s.period_start);
    const end = toUTC(s.period_end);
    if (isNaN(start) || isNaN(end) || end < start) continue;
    const list = byBank.get(bank) ?? [];
    list.push({ start, end });
    byBank.set(bank, list);
  }

  const gaps: CoverageGap[] = [];
  for (const [bank, intervals] of byBank) {
    if (intervals.length < 2) continue;
    intervals.sort((a, b) => a.start - b.start);

    // Merge de intervalos solapados o contiguos (fin + 1 día == inicio siguiente)
    let coveredEnd = intervals[0].end;
    for (let i = 1; i < intervals.length; i++) {
      const cur = intervals[i];
      if (cur.start <= coveredEnd + DAY_MS) {
        coveredEnd = Math.max(coveredEnd, cur.end);
        continue;
      }
      // Hueco: desde el día siguiente al último cubierto hasta el día anterior
      // al inicio del próximo extracto.
      const gapFrom = coveredEnd + DAY_MS;
      const gapTo = cur.start - DAY_MS;
      gaps.push({
        bank,
        from: fromUTC(gapFrom),
        to: fromUTC(gapTo),
        days: Math.round((gapTo - gapFrom) / DAY_MS) + 1,
      });
      coveredEnd = cur.end;
    }
  }

  // Más recientes primero — lo más probable es que el hueco nuevo sea el que importa.
  return gaps.sort((a, b) => b.from.localeCompare(a.from));
}

// ── Cuentas atrasadas: una serie que se quedó sin extractos ─────────────────

export interface SerieAtrasada {
  bank: string;
  /** Último día CON datos de esa cuenta (YYYY-MM-DD). */
  hasta: string;
  /** Días que le lleva de ventaja la cuenta más al día. */
  diasAtras: number;
}

/**
 * Cuentas cuyo último extracto quedó MUY atrás de la cuenta más al día.
 *
 * Caso real (auditoría 2026-11-11): la cuenta principal estaba cargada hasta
 * el 31 de octubre, pero la tarjeta de crédito solo hasta el 25 de junio y
 * la segunda cuenta hasta el 31 de mayo. El banco seguía mostrando el pago
 * automático de la tarjeta cada mes, marcado como traspaso — o sea que las
 * compras de julio a octubre nunca entraron a la app. findCoverageGaps no lo
 * ve: mira huecos ENTRE extractos, no una serie que simplemente se detuvo.
 *
 * Se compara contra la cuenta más al día (no contra hoy): si todavía no
 * subiste nada del mes, eso no es una cuenta atrasada, es el mes en curso.
 * Misma agrupación por bank_name que findCoverageGaps.
 */
export function findSeriesAtrasadas(
  statements: StatementPeriodLike[],
  toleranciaDias = 35,
): SerieAtrasada[] {
  const ultimoPorBanco = new Map<string, number>();
  for (const s of statements) {
    if (!s.period_end) continue;
    const end = toUTC(s.period_end);
    if (isNaN(end)) continue;
    const bank = s.bank_name || 'Banco';
    ultimoPorBanco.set(bank, Math.max(ultimoPorBanco.get(bank) ?? -Infinity, end));
  }
  if (ultimoPorBanco.size < 2) return []; // una sola cuenta: no hay contra qué comparar
  const masAlDia = Math.max(...ultimoPorBanco.values());

  const out: SerieAtrasada[] = [];
  for (const [bank, end] of ultimoPorBanco) {
    const diasAtras = Math.round((masAlDia - end) / DAY_MS);
    if (diasAtras > toleranciaDias) out.push({ bank, hasta: fromUTC(end), diasAtras });
  }
  return out.sort((a, b) => b.diasAtras - a.diasAtras);
}
