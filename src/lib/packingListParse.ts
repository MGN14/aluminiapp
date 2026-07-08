/**
 * Heurísticas de importación de packing list / proforma (pestaña Costeo).
 *
 * Calibradas contra el formato definitivo de proforma de Nico (Cowork):
 *   REF. | Kg/m | Descripcion | Color | UND | KG
 *   … filas de datos (una por referencia+color) …
 *   TOTAL | | | | 19149 | 28486          ← fila de totales
 *   Tope contenedor: 28.400 kg           ← notas al pie
 *   EXCEDE TOPE
 *
 * Gotchas cubiertos:
 *   - "UND"/"UNDS" = unidades → cantidad (antes no matcheaba nada).
 *   - "Kg/m" es peso POR METRO, no peso total → se ignora; el peso real es "KG".
 *   - La fila TOTAL y las notas al pie no son referencias → se filtran.
 */

export type FieldKey = 'reference' | 'descripcion' | 'cantidad' | 'unidad' | 'peso_kg' | 'fob_total_usd' | 'ignorar';

/** Auto-mapeo de columna por nombre de encabezado. */
export function guessField(header: string): FieldKey {
  const h = header.toLowerCase().trim();
  if (!h) return 'ignorar';
  // Peso por metro/unidad ("Kg/m", "kg/und") NO es el peso total del renglón.
  if (/kg\s*\/\s*(m|und|u|pz)/.test(h)) return 'ignorar';
  if (/(ref|código|codigo|item|sku|perfil)/.test(h)) return 'reference';
  if (/(desc|nombre|product|descripc)/.test(h)) return 'descripcion';
  // "UND"/"UNDS" (unidades) es CANTIDAD — va antes que el check de "unidad".
  if (/^unds?\.?$/.test(h)) return 'cantidad';
  if (/(peso|weight|kg|kgs|net)/.test(h)) return 'peso_kg';
  if (/(fob|valor|amount|total|price|precio|usd)/.test(h)) return 'fob_total_usd';
  if (/(unidad|unit|medida|uom)/.test(h)) return 'unidad';
  if (/(cant|qty|quantity|pcs|pzas|piezas|bultos|cajas)/.test(h)) return 'cantidad';
  return 'ignorar';
}

/** Auto-mapea todas las columnas. Cada campo va a UNA sola columna (la
 *  primera que lo matchee); repeticiones quedan en 'ignorar'. */
export function guessMapping(header: string[], colCount: number): FieldKey[] {
  const used = new Set<FieldKey>();
  return Array.from({ length: colCount }, (_, i) => {
    const g = guessField(header[i] ?? '');
    if (g === 'ignorar' || used.has(g)) return 'ignorar';
    used.add(g);
    return g;
  });
}

/** ¿La "referencia" es en realidad una fila de resumen (TOTAL/SUBTOTAL)? */
export function isSummaryReference(reference: string): boolean {
  return /^(sub)?\s*-?\s*total(es)?\b/i.test(reference.trim());
}

/** ¿La fila trae algún dato numérico útil? Filas de solo texto (notas al pie
 *  tipo "Tope contenedor: 28.400 kg", "EXCEDE TOPE") no son referencias. */
export function hasAnyData(item: { cantidad: number; peso_kg: number | null; fob_total_usd: number }): boolean {
  return item.cantidad > 0 || (item.peso_kg ?? 0) > 0 || item.fob_total_usd > 0;
}
