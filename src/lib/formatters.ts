/**
 * Formateadores compartidos. Centralizados para evitar drift entre módulos
 * — ej: agregar decimales a COP debe propagarse a todos los reportes.
 */

const COP_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const COP_NUMBER_FORMATTER = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 0,
});

const COP_NUMBER_FORMATTER_2DEC = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 2,
});

/** Devuelve "$1.234.567" para valores en pesos colombianos. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return COP_FORMATTER.format(0);
  return COP_FORMATTER.format(value);
}

/** Devuelve "1.234.567" sin símbolo. */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0';
  return COP_NUMBER_FORMATTER.format(value);
}

/** Devuelve "1.234,56" con 2 decimales. Para porcentajes/ratios. */
export function formatNumber2Dec(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0';
  return COP_NUMBER_FORMATTER_2DEC.format(value);
}

/** "12.5%" — recibe 0.125 ó 12.5 según el flag. */
export function formatPercent(value: number, fromDecimal = false): string {
  if (!Number.isFinite(value)) return '0%';
  const v = fromDecimal ? value * 100 : value;
  return `${COP_NUMBER_FORMATTER_2DEC.format(v)}%`;
}
