/**
 * Parseo seguro de inputs numéricos del DOM.
 * `parseFloat`/`parseInt` aceptan "1e1000" → Infinity y "abc" → NaN — ambos
 * propagados a estado serían bugs sutiles. Estos helpers descartan los dos.
 */

/** parseFloat con guard: NaN/Infinity → 0. */
export function safeParseFloat(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** safeParseFloat + clamp a [0, 100] para tasas de %. */
export function safeParsePercent(value: string | number | null | undefined): number {
  return Math.max(0, Math.min(100, safeParseFloat(value)));
}

/** parseInt con guard: NaN/Infinity → 0. */
export function safeParseInt(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? Math.trunc(value) : parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** safeParseInt + clamp a rango personalizado. */
export function safeParseIntClamp(
  value: string | number | null | undefined,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, safeParseInt(value)));
}
