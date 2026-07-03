/**
 * Helpers para comparación de strings sin acentos / case-insensitive.
 *
 * Caso típico: el CSV de Bancolombia viene sin tildes ("BOGOTA") pero los
 * usuarios crean reglas o registran clientes con tildes ("BOGOTÁ"). Sin
 * normalizar ambos lados, no matchea.
 */

/**
 * Lowercase + trim + strip de diacríticos (NFD descompone "á" en "a"+̀;
 * regex elimina los marks) + colapso de espacios internos.
 *
 * El colapso de espacios importa para las reglas: el extracto trae dobles
 * espacios ("COMPRA INTL  Spotify", "PAGO PSE DIAN   PSE") y los usuarios
 * escriben keywords con espaciado distinto ("4 X 1000" vs "4X1000" no
 * matchea igual, pero "4 X  1000" vs "4 X 1000" sí debe). Mantener idéntico
 * a la normalización SQL de apply_reconciliation_rules_to_tx.
 */
export function normalizeForMatch(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Normaliza nombres de empresas: además de tildes/case, remueve sufijos
 * comunes (S.A.S, LTDA, S.A.) y caracteres no alfanuméricos.
 *
 * Útil para detectar duplicados o matchear cliente entre fuentes (Siigo,
 * facturas, extractos bancarios).
 */
export function normalizeCompanyName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+s\.?a\.?s\.?\s*$/i, '')
    .replace(/\s+ltda\.?\s*$/i, '')
    .replace(/\s+s\.?a\.?\s*$/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
