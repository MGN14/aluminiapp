/**
 * Parser genérico de texto delimitado (CSV / TSV / pegado de Excel).
 * Detecta el delimitador (coma, punto y coma, o tab), respeta comillas dobles
 * y campos multilínea entre comillas. Sin dependencias — suficiente para
 * packing lists exportados a CSV o copiados desde Excel.
 */

export interface ParsedTable {
  /** Filas crudas (incluye la primera, que puede o no ser encabezado) */
  rows: string[][];
  delimiter: string;
}

function detectDelimiter(text: string): string {
  // Mirá la primera línea no vacía y contá candidatos fuera de comillas.
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const candidates = ['\t', ';', ','];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    // Conteo naive (fuera de comillas) — suficiente para elegir.
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export function parseDelimited(text: string, delimiterOverride?: string): ParsedTable {
  const delimiter = delimiterOverride ?? detectDelimiter(text);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // comilla escapada
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { pushField(); continue; }
    if (ch === '\n') { pushField(); pushRow(); continue; }
    if (ch === '\r') { continue; } // \r\n → ignoramos \r, el \n cierra
    field += ch;
  }
  // último campo / fila
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }

  // Limpiar filas totalmente vacías.
  const cleaned = rows.filter((r) => r.some((c) => c.trim().length > 0));
  return { rows: cleaned, delimiter };
}

/**
 * Convierte "1.234,56" / "1,234.56" / "$ 2.600" / "3.120" a número. Tolerante
 * a formato es-CO (punto = miles) y en-US (coma = miles).
 *
 * Regla para separador ambiguo (solo puntos o solo comas, sin el otro):
 * se trata como DECIMAL únicamente si hay exactamente un separador con 1-2
 * dígitos detrás (1.5, 2,34, 850.50); en cualquier otro caso (2+ separadores,
 * o 3 dígitos detrás como 3.120 / 1.234.567) es separador de miles. En es-CO
 * el caso ambiguo "2.600" se resuelve como 2600 (miles), que es lo correcto
 * para montos de importación.
 */
export function parseLooseNumber(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  // Negativo: signo adelante (-123), paréntesis contable ((123)), signo al
  // final (1.234,56-) o sufijo CR/Cr (crédito) — comunes en balances de prueba.
  const negative = /^-/.test(s) || /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /\bcr\b/i.test(s);
  // Quitar todo lo que no sea dígito, punto o coma (incluye guiones internos y $).
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Ambos presentes: el decimal es el que aparece más a la derecha.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else s = s.replace(/,/g, '');                                        // 1,234.56
  } else if (lastComma > -1) {
    // Solo comas.
    const count = (s.match(/,/g) || []).length;
    const decimals = s.length - lastComma - 1;
    s = count === 1 && decimals >= 1 && decimals <= 2
      ? s.replace(',', '.')   // 2,34 → decimal
      : s.replace(/,/g, '');  // 1,234 / 1,234,567 → miles
  } else if (lastDot > -1) {
    // Solo puntos (caso es-CO crítico): 3.120 es miles, no 3.12.
    const count = (s.match(/\./g) || []).length;
    const decimals = s.length - lastDot - 1;
    s = count === 1 && decimals >= 1 && decimals <= 2
      ? s                     // 1.5 / 850.50 → decimal (ya tiene punto)
      : s.replace(/\./g, ''); // 3.120 / 1.234.567 → miles
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}
