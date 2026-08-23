// Aprendizaje continuo — cotizaciones GANADAS vs PERDIDAS.
//
// La señal que se estaba tirando: cada cotización aceptada o rechazada ya
// guarda margen, cliente, sistema, monto y tiempos. Este análisis la convierte
// en la pregunta que importa al cotizar la próxima: ¿a qué precio gano y a qué
// precio pierdo?
//
// Reglas de honestidad estadística:
//   - Solo cuentan cotizaciones DECIDIDAS (accepted/rejected). Draft, sent y
//     expired no dicen nada del precio (expired es indecisión, no rechazo).
//   - Ningún breakdown se reporta con n < MIN_N: "ganaste 1 de 1" no es tasa.
//   - El margen usa profit_pct solo cuando > 0 (las cotizaciones por plantilla
//     llevan el margen embebido en el precio y reportan 0 — bucket aparte).

export interface WinLossQuote {
  id: string;
  status: string; // solo accepted/rejected cuentan
  total: number;
  profit_pct: number;
  responsible_id: string | null;
  responsible_name: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  /** Sistemas presentes en los ítems (para el breakdown por sistema). */
  systems: string[];
}

export interface WinLossBucket {
  key: string;
  label: string;
  won: number;
  lost: number;
  total: number;
  winRate: number; // 0-100
  /** Valor ganado (Σ total de las aceptadas del bucket). */
  wonValue: number;
}

export interface WinLossResult {
  decided: number;
  won: number;
  lost: number;
  winRate: number; // 0-100
  wonValue: number;
  lostValue: number;
  /** Días promedio entre enviar y decidir (solo con sent_at + fecha de decisión). */
  avgResponseDays: number | null;
  byMargin: WinLossBucket[];
  byClient: WinLossBucket[];
  bySystem: WinLossBucket[];
  byTicket: WinLossBucket[];
  /** Insight accionable en una frase, o null si no hay señal con n suficiente. */
  insight: string | null;
}

export const MIN_N = 3;

const MARGIN_BUCKETS = [
  { key: 'plantilla', label: 'Plantilla (margen embebido)', test: (p: number) => p <= 0 },
  { key: 'lt20', label: 'Margen < 20%', test: (p: number) => p > 0 && p < 20 },
  { key: '20-35', label: 'Margen 20-35%', test: (p: number) => p >= 20 && p < 35 },
  { key: 'gte35', label: 'Margen ≥ 35%', test: (p: number) => p >= 35 },
];

const TICKET_BUCKETS = [
  { key: 'lt2m', label: 'Hasta $2M', test: (t: number) => t < 2_000_000 },
  { key: '2-10m', label: '$2M – $10M', test: (t: number) => t >= 2_000_000 && t < 10_000_000 },
  { key: 'gte10m', label: 'Más de $10M', test: (t: number) => t >= 10_000_000 },
];

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function finishBuckets(map: Map<string, WinLossBucket>): WinLossBucket[] {
  return Array.from(map.values())
    .filter((b) => b.total >= MIN_N)
    .map((b) => ({ ...b, winRate: Math.round((b.won / b.total) * 100) }))
    .sort((a, b) => b.total - a.total);
}

function bump(map: Map<string, WinLossBucket>, key: string, label: string, won: boolean, value: number) {
  const cur = map.get(key) ?? { key, label, won: 0, lost: 0, total: 0, winRate: 0, wonValue: 0 };
  cur.total += 1;
  if (won) { cur.won += 1; cur.wonValue += value; } else { cur.lost += 1; }
  map.set(key, cur);
}

export function computeWinLoss(quotes: WinLossQuote[]): WinLossResult {
  const decided = quotes.filter((q) => q.status === 'accepted' || q.status === 'rejected');
  const won = decided.filter((q) => q.status === 'accepted');
  const lost = decided.filter((q) => q.status === 'rejected');

  const byMargin = new Map<string, WinLossBucket>();
  const byClient = new Map<string, WinLossBucket>();
  const bySystem = new Map<string, WinLossBucket>();
  const byTicket = new Map<string, WinLossBucket>();
  const responseDays: number[] = [];

  for (const q of decided) {
    const isWon = q.status === 'accepted';
    const value = Number(q.total) || 0;

    const mb = MARGIN_BUCKETS.find((b) => b.test(Number(q.profit_pct) || 0));
    if (mb) bump(byMargin, mb.key, mb.label, isWon, value);

    const clientKey = q.responsible_id ?? q.responsible_name ?? '';
    if (clientKey) bump(byClient, clientKey, q.responsible_name ?? '(sin nombre)', isWon, value);

    for (const sys of new Set(q.systems.map((s) => s.trim()).filter(Boolean))) {
      bump(bySystem, sys.toLowerCase(), sys, isWon, value);
    }

    const tb = TICKET_BUCKETS.find((b) => b.test(value));
    if (tb) bump(byTicket, tb.key, tb.label, isWon, value);

    const decidedAt = q.accepted_at ?? q.rejected_at;
    if (q.sent_at && decidedAt) {
      const d = daysBetween(q.sent_at, decidedAt);
      if (d >= 0 && d < 365) responseDays.push(d);
    }
  }

  const marginOut = finishBuckets(byMargin);
  const result: WinLossResult = {
    decided: decided.length,
    won: won.length,
    lost: lost.length,
    winRate: decided.length > 0 ? Math.round((won.length / decided.length) * 100) : 0,
    wonValue: won.reduce((s, q) => s + (Number(q.total) || 0), 0),
    lostValue: lost.reduce((s, q) => s + (Number(q.total) || 0), 0),
    avgResponseDays: responseDays.length >= MIN_N
      ? Math.round(responseDays.reduce((a, b) => a + b, 0) / responseDays.length)
      : null,
    byMargin: marginOut,
    byClient: finishBuckets(byClient).slice(0, 5),
    bySystem: finishBuckets(bySystem).slice(0, 5),
    byTicket: finishBuckets(byTicket),
    insight: null,
  };

  // Insight: el contraste de margen más grande con n suficiente.
  const realMargins = marginOut.filter((b) => b.key !== 'plantilla');
  if (realMargins.length >= 2) {
    const best = [...realMargins].sort((a, b) => b.winRate - a.winRate)[0];
    const worst = [...realMargins].sort((a, b) => a.winRate - b.winRate)[0];
    if (best.key !== worst.key && best.winRate - worst.winRate >= 20) {
      result.insight = `Con ${best.label.toLowerCase()} ganás ${best.winRate}% (${best.won}/${best.total}); con ${worst.label.toLowerCase()}, ${worst.winRate}% (${worst.won}/${worst.total}).`;
    }
  }

  return result;
}
