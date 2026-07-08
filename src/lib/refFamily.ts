/**
 * Familia de referencias — convención interna de Nico para colores:
 *
 *   LIV-40    → sin sufijo (mate)          ┐
 *   LIV-40-0  → crudo                      │ conforman
 *   LIV-40-2  → blanco                     │ LIV-40-5 (el TOTAL,
 *   LIV-40-3  → negro                      │ la referencia de Siigo)
 *   LIV-40-5  → total de todos los colores ┘
 *
 * En Siigo (→ inventory_products) NO se discrimina color: existe solo la
 * "-5". En los packing lists / proformas se usa la base sin sufijo con el
 * color en columna aparte. Esta llave junta ambos mundos: todo cálculo de
 * cobertura/comparación se hace "sobre el -5" agrupando por familia.
 *
 * Verificado contra la maestra real (161 refs, jul 2026): las "-5" son la
 * norma; sufijos -0/-2/-3 casi no existen como filas propias (MGN17-2 sí).
 * Refs "NOUSAR" no terminan en sufijo → quedan como familia propia y no se
 * mezclan con la buena (ej: T116-5NOUSAR ≠ T116-5).
 */

/** Llave canónica de familia: base sin sufijo de color/total, normalizada. */
export function refFamilyKey(reference: string | null | undefined): string {
  const norm = (reference ?? '').trim().toLowerCase();
  const m = /^(.+?)-(0|2|3|5)$/.exec(norm);
  return m ? m[1] : norm;
}
