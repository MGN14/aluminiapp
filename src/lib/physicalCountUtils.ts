// ── Column mapping aliases for physical inventory count files ──

export const PHYSICAL_COLUMN_ALIASES: Record<string, string[]> = {
  referencia: ['referencia', 'código producto', 'codigo producto', 'código', 'codigo', 'ref', 'sku', 'code', 'cod'],
  nombre_producto: ['nombre_producto', 'nombre producto', 'nombre', 'producto', 'descripción', 'descripcion', 'name', 'desc'],
  unidad_medida: ['unidad_medida', 'unidad medida', 'unidad', 'und', 'unit', 'uom', 'medida'],
  unidades_fisicas: ['unidades_fisicas', 'unidades fisicas', 'físico', 'fisico', 'cantidad_física', 'cantidad_fisica', 'conteo', 'inventario_fisico', 'inventario_físico', 'cantidad', 'unidades', 'stock_fisico', 'stock_físico', 'qty'],
};

export type PhysicalField = keyof typeof PHYSICAL_COLUMN_ALIASES;

export interface PhysicalColumnMapping {
  excelHeader: string;
  mappedTo: PhysicalField | null;
  columnIndex: number;
}

export interface PhysicalCountRow {
  referencia: string;
  unidades_fisicas: number;
  nombre_producto: string;
  unidad_medida: string;
  status: 'matched' | 'not_found' | 'error' | 'duplicate';
  issues: string[];
  rowNumber: number;
  existingProductId?: string;
  existingStock?: number;
  difference?: number;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export function detectPhysicalMapping(headers: string[]): PhysicalColumnMapping[] {
  return headers.map((header, idx) => {
    const norm = normalize(header);
    let bestMatch: PhysicalField | null = null;
    for (const [field, aliases] of Object.entries(PHYSICAL_COLUMN_ALIASES)) {
      if (aliases.some(a => norm === a || norm.includes(a) || a.includes(norm))) {
        bestMatch = field as PhysicalField;
        break;
      }
    }
    return { excelHeader: header, mappedTo: bestMatch, columnIndex: idx };
  });
}

function cleanText(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\s+/g, ' ');
}

function parseNumber(val: unknown): number {
  if (val === null || val === undefined) return NaN;
  if (typeof val === 'number') return val;
  const str = String(val).trim().replace(/[$\s]/g, '');
  let cleaned = str;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }
  return parseFloat(cleaned);
}

export function buildPhysicalRows(
  rows: unknown[][],
  mapping: PhysicalColumnMapping[],
  startRow: number
): PhysicalCountRow[] {
  const getField = (row: unknown[], field: PhysicalField): unknown => {
    const col = mapping.find(m => m.mappedTo === field);
    if (!col) return undefined;
    return row[col.columnIndex];
  };

  return rows.map((row, i) => {
    const issues: string[] = [];
    const ref = cleanText(getField(row, 'referencia'));
    const nombre = cleanText(getField(row, 'nombre_producto'));
    const unidad = cleanText(getField(row, 'unidad_medida'));
    const rawQty = getField(row, 'unidades_fisicas');
    const qty = parseNumber(rawQty);

    if (!ref) issues.push('Sin referencia');
    if (isNaN(qty)) issues.push('Cantidad no numérica');

    const status: PhysicalCountRow['status'] = issues.length > 0 ? 'error' : 'matched';

    return {
      referencia: ref,
      unidades_fisicas: isNaN(qty) ? 0 : qty,
      nombre_producto: nombre,
      unidad_medida: unidad,
      status,
      issues,
      rowNumber: startRow + i,
    };
  });
}

export function markPhysicalDuplicates(rows: PhysicalCountRow[]): PhysicalCountRow[] {
  const seen = new Map<string, number>();
  return rows.map(r => {
    if (!r.referencia || r.status === 'error') return r;
    const key = r.referencia.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      return { ...r, status: 'duplicate' as const, issues: [...r.issues, 'Referencia duplicada'] };
    }
    return r;
  });
}

export interface ExistingProduct {
  id: string;
  reference: string;
  stock_system: number;
  name: string;
}

/** Fila del maestro de productos usada para traducir referencias por color. */
export interface MasterProduct {
  ref_siigo: string;
  ref_local: string | null;
  ref_proveedor_a: string | null;
  ref_proveedor_b: string | null;
  ref_proveedor_c: string | null;
}

/**
 * Cruza el conteo físico contra el inventario contable (Siigo), resolviendo
 * la diferencia de formato entre ambos:
 *   - Siigo usa un código por producto, con sufijo "-5" y SIN color (ej: 38x38-5).
 *   - El conteo físico viene POR COLOR: sin sufijo (38x38), -2 Blanco, -3 Negro,
 *     -0 Crudo.
 * El maestro (product_master) tiene esa equivalencia precargada (ref_local +
 * proveedores A/B/C apuntando a la ref_siigo). Acá la usamos para que el
 * bodeguero cuente con su referencia de color y el sistema la reconozca sin
 * cuadre manual. Como varios colores del mismo producto resuelven a la misma
 * ref Siigo, el import (handleImport) suma sus unidades.
 */
export function crossReferenceWithInventory(
  rows: PhysicalCountRow[],
  existingProducts: ExistingProduct[],
  masterProducts: MasterProduct[] = []
): PhysicalCountRow[] {
  const productMap = new Map(existingProducts.map(p => [p.reference.toLowerCase().trim(), p]));

  // Cualquier columna de referencia del maestro -> ref_siigo canónica (lower).
  const masterResolve = new Map<string, string>();
  for (const m of masterProducts) {
    const target = (m.ref_siigo ?? '').toString().toLowerCase().trim();
    if (!target) continue;
    for (const v of [m.ref_siigo, m.ref_local, m.ref_proveedor_a, m.ref_proveedor_b, m.ref_proveedor_c]) {
      const k = (v ?? '').toString().toLowerCase().trim();
      if (k) masterResolve.set(k, target);
    }
  }

  // Resuelve una referencia del conteo a un producto del inventario contable.
  const resolveProduct = (rawRef: string): ExistingProduct | undefined => {
    const r = rawRef.toLowerCase().trim();
    if (!r) return undefined;
    // 1) Match directo contra Siigo.
    let p = productMap.get(r);
    if (p) return p;
    // 2) Vía maestro: ref física (color) -> ref_siigo -> Siigo.
    const canon = masterResolve.get(r);
    if (canon && (p = productMap.get(canon))) return p;
    // 3) Fallback algorítmico: quitar color (-0/-2/-3), volver a la base y
    //    probar base+"-5" (formato Siigo). Cubre productos aún no en el maestro.
    const base = r.replace(/-[023]$/, '');
    const canonBase = masterResolve.get(base);
    if (canonBase && (p = productMap.get(canonBase))) return p;
    if ((p = productMap.get(`${base}-5`))) return p;
    if ((p = productMap.get(base))) return p;
    return undefined;
  };

  return rows.map(r => {
    if (r.status === 'error') return r;
    const product = resolveProduct(r.referencia);
    if (!product) {
      return { ...r, status: 'not_found' as const, issues: [...r.issues, 'No encontrada en inventario contable'] };
    }
    const diff = product.stock_system - r.unidades_fisicas;
    return {
      ...r,
      status: r.status === 'duplicate' ? 'duplicate' : 'matched',
      existingProductId: product.id,
      existingStock: product.stock_system,
      difference: diff,
    };
  });
}
