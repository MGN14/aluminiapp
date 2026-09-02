/**
 * Detector de clientes que PARECEN el mismo tercero con nombre distinto.
 *
 * Caso real (Nico 2026-09-02): al remisionar se crea el cliente "como lo
 * conocemos" ("ALUMINIOS Y AMORTIGUADORES LA 11") y al facturar aparece la
 * razón social registrada ("Aluminios Armotiguadores y Respuestos la 11") —
 * palabras distintas para el normalizador, imposible unirlas automáticamente
 * con seguridad. Este detector las marca como "posible duplicado" para que
 * el usuario las una con UN clic (RPC merge_responsibles).
 *
 * Método: tokens del nombre normalizado (sin stopwords) con matching difuso
 * por token (Levenshtein ≤1 para tokens de 5-7 letras, ≤2 para ≥8 — cubre
 * "amortiguadores"↔"armotiguadores"). Score = tokens matcheados / tamaño del
 * nombre más corto. Umbral 0.8 + al menos un token "fuerte" (≥4 letras).
 */
import { normalizeName } from './clientReceivables';

const STOPWORDS = new Set(['y', 'e', 'de', 'del', 'la', 'el', 'los', 'las', 'sas', 'sa', 'ltda']);

export interface DuplicateCandidate {
  client_id: string;
  client_name: string;
}

export interface DuplicatePair {
  a: DuplicateCandidate;
  b: DuplicateCandidate;
  score: number;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 5) return false; // tokens cortos y números: solo igualdad exacta
  const max = len >= 8 ? 2 : 1;
  return levenshtein(a, b, max) <= max;
}

function significantTokens(name: string): string[] {
  return Array.from(new Set(
    normalizeName(name)
      .split(' ')
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  ));
}

/** Score de similitud entre dos nombres ya normalizables (0..1). */
export function nameSimilarity(nameA: string, nameB: string): number {
  const ta = significantTokens(nameA);
  const tb = significantTokens(nameB);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const usados = new Set<number>();
  let matched = 0;
  let strongMatch = false;
  for (const t of short) {
    for (let i = 0; i < long.length; i++) {
      if (usados.has(i)) continue;
      if (tokensMatch(t, long[i])) {
        usados.add(i);
        matched++;
        if (t.length >= 4) strongMatch = true;
        break;
      }
    }
  }
  if (!strongMatch || matched < 2) return 0;
  return matched / short.length;
}

/**
 * Pares de clientes que probablemente son el MISMO tercero. Excluye pares
 * cuyos nombres normalizan IGUAL (esos ya los funde el motor solo).
 */
export function findLikelyDuplicateClients(
  clients: DuplicateCandidate[],
  threshold = 0.8,
): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  for (let i = 0; i < clients.length; i++) {
    for (let j = i + 1; j < clients.length; j++) {
      const a = clients[i];
      const b = clients[j];
      if (normalizeName(a.client_name) === normalizeName(b.client_name)) continue;
      const score = nameSimilarity(a.client_name, b.client_name);
      if (score >= threshold) out.push({ a, b, score });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 10);
}
