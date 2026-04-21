/**
 * Parser determinístico del CSV de movimientos de Bancolombia.
 *
 * Formato del CSV (sin headers, separador coma):
 *   cuenta, cod_sucursal, cod_desconocido, fecha_DDMMYYYY, vacío, valor, codigo_DCTO, descripción, estado
 *
 * Ejemplo:
 *   38800002200,388,7,31032026,,-1609476.00,2715,TRANSFERENCIA VIRTUAL,00
 *
 * Notas:
 *  - La fecha viene como DDMMYYYY concatenado sin separadores.
 *  - El valor puede ser negativo (egreso) o positivo (ingreso).
 *  - Descripciones pueden tener asterisco al final (cosmético) y espacios
 *    dobles internos — se normalizan para matching consistente con el XLSX.
 *  - Reglas de normalización de descripción (ver ANALISIS_CONCILIACION_SEMANAL.md):
 *      1. trim
 *      2. colapsar espacios múltiples a uno solo
 *      3. quitar asterisco final
 *      4. uppercase
 *
 * Este módulo es puro (sin side effects, sin I/O) para que pueda correr
 * tanto en el browser, en el edge function Deno, o en tests Node.
 */

export interface BancolombiaMovement {
  /** Número de cuenta (columna 1). */
  account: string;
  /** Código de sucursal (columna 2). */
  sucursal: string;
  /** Fecha del movimiento en formato ISO YYYY-MM-DD. */
  date: string;
  /** Valor con signo: positivo = ingreso, negativo = egreso. */
  amount: number;
  /** Monto positivo si es crédito (ingreso), null si es débito. */
  credit: number | null;
  /** Monto positivo si es débito (egreso), null si es crédito. */
  debit: number | null;
  /** Código DCTO del banco (ej: "2715", "3339"). Corresponde a transactions.dcto. */
  dcto: string;
  /** Descripción tal como viene del CSV (sin normalizar). */
  description: string;
  /** Descripción normalizada (trim, sin espacios dobles, sin asterisco final, uppercase). */
  normalizedDescription: string;
  /** Código de estado del movimiento (ej: "00"). */
  status: string;
  /** Línea raw original, útil para auditoría. */
  rawLine: string;
  /** Número de línea en el CSV (1-based). */
  lineNumber: number;
}

export interface ParseError {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

export interface ParseResult {
  movements: BancolombiaMovement[];
  errors: ParseError[];
  summary: {
    rowCount: number;
    totalCredits: number;
    totalDebits: number;
    netFlow: number;
    dateRange: { start: string; end: string } | null;
    accountsSeen: string[];
  };
}

/**
 * Normaliza una descripción para matching consistente con el XLSX del extracto.
 */
export function normalizeDescription(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\*+$/, "")
    .trim()
    .toUpperCase();
}

/**
 * Convierte una fecha `DDMMYYYY` (8 dígitos concatenados) a ISO `YYYY-MM-DD`.
 * Devuelve null si el formato es inválido.
 */
export function parseDateDDMMYYYY(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{8}$/.test(trimmed)) return null;
  const day = trimmed.slice(0, 2);
  const month = trimmed.slice(2, 4);
  const year = trimmed.slice(4, 8);

  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;

  // Validación estricta: asegurarse que la fecha sea real (ej. 31/02 no existe)
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

/**
 * Parsea un monto en formato Bancolombia.
 *
 * Admite formatos observados en fixtures reales:
 *   "1234.56"   → 1234.56
 *   "-1234.56"  → -1234.56
 *   "-.52"      → -0.52
 *   ".07"       → 0.07
 *   "0"         → 0
 *
 * Devuelve null si no es numérico.
 */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^-?\d*\.?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Split CSV line respecting simple quoted fields. Bancolombia no usa comillas
 *  en los fixtures observados, pero implementamos un split robusto por si acaso. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parsea el contenido completo de un CSV de movimientos de Bancolombia.
 * Nunca tira: los errores por fila se acumulan en `result.errors`.
 */
export function parseBancolombiaCsv(text: string): ParseResult {
  // Normalizar line endings y quitar BOM si viene de Windows
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n");

  const movements: BancolombiaMovement[] = [];
  const errors: ParseError[] = [];
  const accountSet = new Set<string>();
  let totalCredits = 0;
  let totalDebits = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const lineNumber = idx + 1;

    // Saltar líneas vacías (incluye el \n final del archivo)
    if (rawLine.trim() === "") continue;

    const fields = splitCsvLine(rawLine);
    if (fields.length < 9) {
      errors.push({
        lineNumber,
        rawLine,
        reason: `Esperaba 9 columnas, encontró ${fields.length}.`,
      });
      continue;
    }

    const [account, sucursal, , dateRaw, , amountRaw, dcto, description, status] = fields;

    const date = parseDateDDMMYYYY(dateRaw);
    if (!date) {
      errors.push({
        lineNumber,
        rawLine,
        reason: `Fecha inválida: "${dateRaw}" (esperado DDMMYYYY).`,
      });
      continue;
    }

    const amount = parseAmount(amountRaw);
    if (amount === null) {
      errors.push({
        lineNumber,
        rawLine,
        reason: `Monto inválido: "${amountRaw}".`,
      });
      continue;
    }

    const mov: BancolombiaMovement = {
      account: account.trim(),
      sucursal: sucursal.trim(),
      date,
      amount,
      credit: amount > 0 ? amount : null,
      debit: amount < 0 ? Math.abs(amount) : null,
      dcto: dcto.trim(),
      description: description,
      normalizedDescription: normalizeDescription(description),
      status: status.trim(),
      rawLine,
      lineNumber,
    };

    movements.push(mov);
    accountSet.add(mov.account);

    if (amount > 0) totalCredits += amount;
    else if (amount < 0) totalDebits += amount;

    if (minDate === null || date < minDate) minDate = date;
    if (maxDate === null || date > maxDate) maxDate = date;
  }

  return {
    movements,
    errors,
    summary: {
      rowCount: movements.length,
      totalCredits: round2(totalCredits),
      totalDebits: round2(totalDebits),
      netFlow: round2(totalCredits + totalDebits),
      dateRange: minDate && maxDate ? { start: minDate, end: maxDate } : null,
      accountsSeen: Array.from(accountSet),
    },
  };
}

/** Redondea a 2 decimales evitando errores de punto flotante. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
