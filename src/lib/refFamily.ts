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

// ── Consistencia sufijo ↔ columna Color ────────────────────────────────────
// Los dos formatos de subida conviven:
//   PROFORMA (China, no maneja sufijos): ref base (LIV-40) + Color en columna.
//   PACKING LIST definitivo: ref CON sufijo (LIV-40-3) + Color en columna.
// Cuando vienen ambos, tienen que coincidir — un -3 (negro) con Color
// "Blanco" es un error de datos que hay que ver ANTES de confirmar.

export type ColorSufijo = 'crudo' | 'blanco' | 'negro' | 'total';

const SUFIJO_COLOR: Record<string, ColorSufijo> = {
  '0': 'crudo',
  '2': 'blanco',
  '3': 'negro',
  '5': 'total',
};

/** Color implicado por el sufijo de la referencia; null = sin sufijo (mate). */
export function colorFromSuffix(reference: string | null | undefined): ColorSufijo | null {
  const norm = (reference ?? '').trim().toLowerCase();
  const m = /^.+?-(0|2|3|5)$/.exec(norm);
  return m ? SUFIJO_COLOR[m[1]] : null;
}

/** Normaliza el texto de la columna Color a la paleta conocida; null = no reconocido. */
export function normalizeColor(color: string | null | undefined): string | null {
  const c = (color ?? '').trim().toLowerCase();
  if (!c) return null;
  if (/crud/.test(c)) return 'crudo';
  if (/blanc|white/.test(c)) return 'blanco';
  if (/negr|black/.test(c)) return 'negro';
  if (/mate|matte|natural/.test(c)) return 'mate';
  return c; // color no estándar (champagne, etc.): se conserva tal cual
}

/**
 * Sufijo de color a partir de la columna Color de la proforma (la china no
 * maneja sufijos, la app se lo pone): LIV-40 + "Blanco" → LIV-40-2.
 * Mate = sin sufijo (convención de Nico). Colores no estándar → base tal cual.
 * Si la ref YA trae sufijo de color, se respeta (caso packing list).
 */
export function applyColorSuffix(reference: string, color: string | null | undefined): string {
  const ref = (reference ?? '').trim();
  if (!ref) return ref;
  if (colorFromSuffix(ref) !== null) return ref; // ya viene con sufijo
  const c = normalizeColor(color);
  if (c === 'crudo') return `${ref}-0`;
  if (c === 'blanco') return `${ref}-2`;
  if (c === 'negro') return `${ref}-3`;
  return ref; // mate / sin color / no estándar
}

/** Llave de VARIANTE (color): la referencia completa normalizada, sin agrupar.
 *  LIV-40-2 ≠ LIV-40-3 ≠ LIV-40 (mate) ≠ LIV-40-5 (total sin discriminar). */
export function variantKey(reference: string | null | undefined): string {
  return (reference ?? '').trim().toLowerCase();
}

/** Etiqueta legible del color según el sufijo (para la tabla de cobertura). */
export function colorLabel(reference: string): string {
  const c = colorFromSuffix(reference);
  if (c === 'total') return 'sin discriminar';
  if (c === null) return 'mate';
  return c;
}

/**
 * ¿El sufijo de la referencia contradice la columna Color?
 * Devuelve el texto del problema, o null si todo bien.
 * - Ref sin sufijo (proforma o mate) → nunca es error.
 * - Ref -5 (total) en un renglón físico → aviso: el total no viaja en cajas.
 * - Ref -0/-2/-3 con Color distinto → error de datos.
 */
export function suffixColorConflict(reference: string, color: string | null | undefined): string | null {
  const sufijo = colorFromSuffix(reference);
  if (sufijo === null) return null; // base: el color de la columna manda (proforma)
  if (sufijo === 'total') {
    return `${reference.trim()}: termina en -5 (el TOTAL de colores) — un renglón físico debería venir por color o sin sufijo`;
  }
  const col = normalizeColor(color);
  if (col === null) return null; // sin columna color: el sufijo manda (ok)
  if (col !== sufijo) {
    return `${reference.trim()}: el sufijo dice "${sufijo}" pero la columna Color dice "${(color ?? '').trim()}"`;
  }
  return null;
}
