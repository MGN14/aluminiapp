/**
 * Parser determinístico del CSV de movimientos de TARJETA DE CRÉDITO de Bancolombia.
 *
 * OJO: es un formato DISTINTO al CSV de cuenta bancaria (ver bancolombiaCsvParser.ts):
 *   - Separador ';' (no ',').
 *   - Trae una línea de ENCABEZADO que hay que saltar.
 *   - Fecha en formato YYYYMMDD (no DDMMYYYY).
 *   - Monto en formato colombiano con símbolo: "$ 1.170.231,93" (punto miles,
 *     coma decimales). El negativo viene como "-$ 1.170.231,93".
 *   - NO trae descripción / comercio.
 *
 * Encabezado real del archivo:
 *   NÚMERO DE PRODUCTO;TIPO CUENTA;EMISOR;FECHA;MONEDA;VALOR;PLAZO;FECHA FACTURACIÓN;TASA;
 *
 * Ejemplo de filas:
 *   *2047;3;1;20260625;COP;$ 36,80;0;00000000;0000;
 *   *2047;3;1;20260616;COP;-$ 1.170.231,93;0;00000000;0000;
 *
 * CONVENCIÓN DE SIGNO (clave para contabilizar):
 *   - VALOR > 0  → COMPRA / cargo a la tarjeta  → es un GASTO.
 *   - VALOR < 0  → ABONO / pago a la tarjeta     → reduce el saldo (no es ingreso).
 *
 *   Esto es el OPUESTO de la cuenta bancaria, donde positivo = ingreso. Por eso
 *   este parser expone `charge`/`payment` ya desambiguados y NO reusa el signo
 *   crudo para clasificar ingreso/egreso. La capa de integración decide cómo
 *   mapear a transactions (ver toTransactionAmount()).
 *
 * Módulo puro (sin side effects, sin I/O): corre en browser, en edge Deno o en tests.
 */

export interface BancolombiaCardMovement {
  /** Número de producto / últimos dígitos de la tarjeta (col 1, ej "*2047"). */
  product: string;
  /** Código de tipo de cuenta (col 2, ej "3"). */
  accountTypeCode: string;
  /** Código de emisor (col 3, ej "1" = Bancolombia). */
  issuerCode: string;
  /** Fecha del movimiento en ISO YYYY-MM-DD. */
  date: string;
  /** Moneda (col 5, ej "COP"). */
  currency: string;
  /** Valor con el signo CRUDO del CSV: + = compra, − = abono/pago. */
  rawValue: number;
  /** Monto de la compra (gasto) en positivo; null si la fila es un abono. */
  charge: number | null;
  /** Monto del abono/pago a la tarjeta en positivo; null si la fila es una compra. */
  payment: number | null;
  /** true si es compra (cargo), false si es abono/pago. */
  isCharge: boolean;
  /** Número de cuotas / plazo (col 7). 0 = una sola cuota. */
  installments: number;
  /** Fecha de facturación en ISO, o null si viene "00000000". */
  billingDate: string | null;
  /** Tasa (col 9, ej "0000"). Se conserva como string crudo. */
  rate: string;
  rawLine: string;
  lineNumber: number;
}

export interface CardParseError {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

export interface CardParseResult {
  movements: BancolombiaCardMovement[];
  errors: CardParseError[];
  summary: {
    rowCount: number;
    /** Suma de compras (gastos). */
    totalCharges: number;
    /** Suma de abonos/pagos a la tarjeta. */
    totalPayments: number;
    dateRange: { start: string; end: string } | null;
    products: string[];
  };
}

/** Convierte una fecha `YYYYMMDD` (8 dígitos) a ISO `YYYY-MM-DD`. null si inválida. */
export function parseDateYYYYMMDD(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{8}$/.test(t)) return null;
  const year = t.slice(0, 4);
  const month = t.slice(4, 6);
  const day = t.slice(6, 8);
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Parsea un monto en formato colombiano de tarjeta: "$ 1.170.231,93".
 *   - Símbolo "$" y espacios opcionales.
 *   - "." como separador de miles, "," como separador decimal.
 *   - Signo "-" al inicio (puede venir antes o después del "$").
 * Devuelve null si no es numérico.
 */
export function parseCardAmount(raw: string): number | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const negative = trimmed.includes("-");
  // Quitar signo, símbolo de moneda y espacios.
  let s = trimmed.replace(/-/g, "").replace(/\$/g, "").replace(/\s/g, "");
  // Quitar separadores de miles (puntos) y pasar coma decimal a punto.
  s = s.replace(/\./g, "").replace(",", ".");
  if (s === "" || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** ¿Es la línea de encabezado? (empieza con "NÚMERO DE PRODUCTO" o no-numérica). */
function isHeaderLine(fields: string[]): boolean {
  const first = (fields[0] ?? "").trim().toUpperCase();
  return first.startsWith("N") && first.includes("PRODUCTO");
}

/**
 * Parsea el contenido completo de un CSV de tarjeta de crédito Bancolombia.
 * Nunca tira: los errores por fila se acumulan en `result.errors`.
 */
export function parseBancolombiaCardCsv(text: string): CardParseResult {
  const clean = (text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n");

  const movements: BancolombiaCardMovement[] = [];
  const errors: CardParseError[] = [];
  const productSet = new Set<string>();
  let totalCharges = 0;
  let totalPayments = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const lineNumber = idx + 1;
    if (rawLine.trim() === "") continue;

    const fields = rawLine.split(";");
    if (isHeaderLine(fields)) continue;

    // El formato trae un ';' final → 9 columnas de datos + 1 vacía. Aceptamos >= 9.
    if (fields.length < 9) {
      errors.push({
        lineNumber,
        rawLine,
        reason: `Esperaba 9 columnas, encontró ${fields.length}.`,
      });
      continue;
    }

    const [product, accountTypeCode, issuerCode, dateRaw, currency, valueRaw, plazoRaw, billingRaw, rate] = fields;

    const date = parseDateYYYYMMDD(dateRaw);
    if (!date) {
      errors.push({ lineNumber, rawLine, reason: `Fecha inválida: "${dateRaw}" (esperado YYYYMMDD).` });
      continue;
    }

    const rawValue = parseCardAmount(valueRaw);
    if (rawValue === null) {
      errors.push({ lineNumber, rawLine, reason: `Monto inválido: "${valueRaw}".` });
      continue;
    }

    const installments = Number((plazoRaw ?? "").trim()) || 0;
    const billingDate = parseDateYYYYMMDD(billingRaw ?? ""); // "00000000" → null
    const isCharge = rawValue >= 0;

    const mov: BancolombiaCardMovement = {
      product: (product ?? "").trim(),
      accountTypeCode: (accountTypeCode ?? "").trim(),
      issuerCode: (issuerCode ?? "").trim(),
      date,
      currency: (currency ?? "").trim(),
      rawValue,
      charge: isCharge ? rawValue : null,
      payment: isCharge ? null : Math.abs(rawValue),
      isCharge,
      installments,
      billingDate,
      rate: (rate ?? "").trim(),
      rawLine,
      lineNumber,
    };

    movements.push(mov);
    productSet.add(mov.product);
    if (isCharge) totalCharges += rawValue;
    else totalPayments += Math.abs(rawValue);

    if (minDate === null || date < minDate) minDate = date;
    if (maxDate === null || date > maxDate) maxDate = date;
  }

  return {
    movements,
    errors,
    summary: {
      rowCount: movements.length,
      totalCharges: round2(totalCharges),
      totalPayments: round2(totalPayments),
      dateRange: minDate && maxDate ? { start: minDate, end: maxDate } : null,
      products: Array.from(productSet),
    },
  };
}

/**
 * Mapea un movimiento de tarjeta al `amount` con la convención de `transactions`
 * (positivo = ingreso, negativo = egreso), para reusar el pipeline existente:
 *   - COMPRA  (charge)  → egreso  → amount NEGATIVO.
 *   - ABONO   (payment) → ingreso → amount POSITIVO (es el pago a la tarjeta).
 *
 * NOTA CONTABLE: el abono a la tarjeta NO es un ingreso del negocio — es un
 * traslado desde el banco. Por defecto lo dejamos fuera de la importación
 * (ver `chargesOnly` en la capa de UI) para no inflar ingresos ni doble-contar
 * con el "PAGO TARJETA" que ya figura como egreso en la cuenta bancaria.
 */
export function toTransactionAmount(mov: BancolombiaCardMovement): number {
  return -mov.rawValue;
}

/** Descripción sintética (el CSV de tarjeta no trae comercio). */
export function buildCardDescription(mov: BancolombiaCardMovement): string {
  const tail = mov.product ? ` ${mov.product}` : "";
  if (mov.isCharge) {
    const cuotas = mov.installments > 1 ? ` (${mov.installments} cuotas)` : "";
    return `Compra TC${tail}${cuotas}`;
  }
  return `Pago/abono TC${tail}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
