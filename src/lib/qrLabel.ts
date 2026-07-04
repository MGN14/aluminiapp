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
  /** Serial único del bulto (LPN). Presente solo en etiquetas serializadas. */
  serial?: string;
}

/** Construye el contenido del QR para una etiqueta de paquete. */
export function encodeLabelPayload(reference: string, quantity: number, location?: string, serial?: string): string {
  const ref = reference.trim().replace(/\|/g, '/');
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const loc = (location ?? '').trim().replace(/\|/g, '/');
  const ser = (serial ?? '').trim().replace(/\|/g, '/');
  let payload = `${QR_PREFIX}|${ref}|${qty}`;
  if (loc || ser) payload += `|${loc}`;   // la ubicación queda en posición fija (puede ir vacía)
  if (ser) payload += `|${ser}`;
  return payload;
}

/** Tope de sanidad: ninguna etiqueta legítima trae más unidades que esto. */
const MAX_QTY = 100_000;

/**
 * Parsea lo que la pistola "tecleó". Tolerante a varios formatos:
 *   - "ALU|744-100|6|A1" → { reference: '744-100', quantity: 6, location: 'A1' }
 *   - "alu|744-100|6"    → prefijo case-insensitive (CapsLock / layout raro)
 *   - "]Q1ALU|744-100|6" → ignora el identificador de simbología AIM (]Q1, ]C1…)
 *   - "?ALU|744-100|6"   → ignora basura NO alfanumérica antes del prefijo
 *   - "ALU|744-100"      → { reference: '744-100', quantity: 1 }  (etiqueta sin cantidad)
 *   - "744-100"          → { reference: '744-100', quantity: 1 }  (código pelado / fallback)
 * Devuelve null si no hay una referencia utilizable, o si la lectura trae DOS
 * payloads pegados (se perdió el Enter entre dos escaneos): en ese caso es más
 * seguro rechazar y que el operario re-escanee, antes que registrar basura.
 */
export function parseScan(raw: string): ScannedLabel | null {
  let s = (raw ?? '').trim();
  if (!s) return null;

  // Identificador de simbología AIM (]Q1 para QR, ]C1 para Code128…) que
  // algunas pistolas anteponen a la lectura.
  s = s.replace(/^\][A-Za-z]\d/, '').trim();
  if (!s) return null;

  // Saneo del prefijo: si "ALU|" no está al comienzo exacto, decidimos si lo
  // que hay antes es basura de la pistola (solo signos → se descarta) o parte
  // de otra lectura pegada (alfanumérico → ilegible).
  const marker = `${QR_PREFIX}|`;
  const upper = s.toUpperCase();
  const first = upper.indexOf(marker);
  if (first >= 0 && upper.indexOf(marker, first + marker.length) >= 0) return null; // dos payloads pegados
  if (first > 0) {
    const before = s.slice(0, first);
    if (/^[^0-9A-Za-z]+$/.test(before)) s = s.slice(first);
    else return null;
  }

  const parts = s.split('|').map(p => p.trim());
  let reference: string;
  let quantity = 1;
  let location: string | undefined;
  let serial: string | undefined;

  if (parts[0].toUpperCase() === QR_PREFIX) {
    reference = parts[1] ?? '';
    const q = toQty(parts[2]);
    if (q != null) quantity = q;
    if (parts[3]) location = parts[3];
    if (parts[4]) serial = parts[4];
  } else if (parts.length >= 2 && parts[0]) {
    // "ref|qty" sin prefijo — tolerante por si una etiqueta vieja no lo trae.
    reference = parts[0];
    const q = toQty(parts[1]);
    if (q != null) quantity = q;
  } else {
    reference = s;
  }

  if (!reference) return null;
  return { reference, quantity, location, serial };
}

function toQty(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= MAX_QTY ? n : null;
}

/** Normaliza una referencia para comparaciones case-insensitive. */
export function normalizeRef(r: string): string {
  return (r ?? '').trim().toLowerCase();
}
