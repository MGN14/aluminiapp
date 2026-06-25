// Formato del QR de etiqueta: "ALU|<referencia>|<cantidad>|<ubicación>".
//
//   - "ALU"      → prefijo/namespace. Sirve para ignorar códigos de barras
//                  ajenos (de proveedores, productos de góndola, etc.).
//   - referencia → la llave de negocio (inventory_products.reference).
//   - cantidad   → unidades que trae ESE paquete, horneadas al imprimir.
//   - ubicación  → posición en bodega (ej: A1, B4). Opcional.
//
// El delimitador es "|". Las referencias de aluminio son alfanuméricas con
// guiones, así que no chocan; por las dudas, al codificar reemplazamos "|" por
// "/" para no romper el parseo. La ubicación es retro-compatible: las etiquetas
// viejas sin ubicación ("ALU|ref|qty") se siguen leyendo igual.

export const QR_PREFIX = 'ALU';

export interface ScannedLabel {
  reference: string;
  quantity: number;
  location?: string;
}

/** Construye el contenido del QR para una etiqueta de paquete. */
export function encodeLabelPayload(reference: string, quantity: number, location?: string): string {
  const ref = reference.trim().replace(/\|/g, '/');
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const loc = (location ?? '').trim().replace(/\|/g, '/');
  return loc ? `${QR_PREFIX}|${ref}|${qty}|${loc}` : `${QR_PREFIX}|${ref}|${qty}`;
}

/**
 * Parsea lo que la pistola "tecleó". Tolerante a varios formatos:
 *   - "ALU|744-100|6|A1" → { reference: '744-100', quantity: 6, location: 'A1' }
 *   - "ALU|744-100|6"    → { reference: '744-100', quantity: 6 }
 *   - "ALU|744-100"      → { reference: '744-100', quantity: 1 }  (etiqueta sin cantidad)
 *   - "744-100"          → { reference: '744-100', quantity: 1 }  (código pelado / fallback)
 * Devuelve null si no hay una referencia utilizable.
 */
export function parseScan(raw: string): ScannedLabel | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  const parts = s.split('|');
  let reference: string;
  let quantity = 1;
  let location: string | undefined;

  if (parts[0] === QR_PREFIX) {
    reference = (parts[1] ?? '').trim();
    const q = toQty(parts[2]);
    if (q != null) quantity = q;
    const loc = (parts[3] ?? '').trim();
    if (loc) location = loc;
  } else if (parts.length >= 2 && parts[0].trim()) {
    // "ref|qty" sin prefijo — tolerante por si una etiqueta vieja no lo trae.
    reference = parts[0].trim();
    const q = toQty(parts[1]);
    if (q != null) quantity = q;
  } else {
    reference = s;
  }

  if (!reference) return null;
  return { reference, quantity, location };
}

function toQty(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normaliza una referencia para comparaciones case-insensitive. */
export function normalizeRef(r: string): string {
  return (r ?? '').trim().toLowerCase();
}
