/**
 * Cruce tolerante de nombres de cliente (remisión ↔ factura de Siigo).
 *
 * El caso real que rompió el `.includes()` exacto (reporte de Nico
 * 2026-08-01): la remisión dice "ALUMINIOS Y AMORTIGUADORES LA 11" y Siigo
 * facturó a "Aluminios Armotiguadores y Respuestos la 11" — typos, orden
 * distinto y palabras extra. Acá se tokeniza, se botan las palabras vacías
 * (y/de/la/sas…) y se acepta typo por token según su largo.
 */

const STOPWORDS = new Set([
  'y', 'e', 'de', 'del', 'la', 'el', 'los', 'las', 'en',
  'sas', 'sa', 'ltda', 'cia', 'inc', 'co',
]);

/** Tokens significativos: minúsculas, sin tildes, sin puntuación, sin vacías. */
export function nameTokens(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t)); // >1: "S.A.S" suelta s/a/s
}

/** Levenshtein con corte temprano (solo necesitamos saber si ≤ max). */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Typo permitido según largo: exacto hasta 4 letras, 1 hasta 7, 2 de 8+. */
function tokenInList(t: string, candidates: string[]): boolean {
  const maxDist = t.length >= 8 ? 2 : t.length >= 5 ? 1 : 0;
  return candidates.some(
    (c) => c === t || (maxDist > 0 && editDistanceAtMost(t, c, maxDist)),
  );
}

/**
 * ¿El cliente de la remisión "es" el de la factura? true si al menos el 60%
 * de los tokens significativos del beneficiario aparecen (con typo tolerado)
 * en el nombre de la factura. Orden y palabras extra no importan.
 */
export function clientNameMatches(beneficiary: string, counterparty: string): boolean {
  const bTokens = nameTokens(beneficiary);
  const cTokens = nameTokens(counterparty);
  if (!bTokens.length || !cTokens.length) return false;
  const hits = bTokens.filter((t) => tokenInList(t, cTokens)).length;
  return hits / bTokens.length >= 0.6;
}
