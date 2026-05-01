/**
 * Constantes compartidas entre módulos. Centralizadas para evitar drift.
 * Para constantes de dominio fiscal (UVT, IVA, etc.), ver lib/uvt.ts y
 * types/transaction.ts.
 */

/** Etiquetas largas de meses en español. Index 0=enero, 11=diciembre. */
export const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

/** Etiquetas cortas de meses en español (3 letras). Index 0=ene. */
export const MONTH_LABELS_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
] as const;

/** Returns "Octubre 2026" given month=10, year=2026. Month is 1-12. */
export function formatMonthLabel(month: number, year: number): string {
  const idx = Math.max(0, Math.min(11, month - 1));
  return `${MONTH_LABELS[idx]} ${year}`;
}
