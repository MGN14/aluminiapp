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

export function crossReferenceWithInventory(
  rows: PhysicalCountRow[],
  existingProducts: ExistingProduct[]
): PhysicalCountRow[] {
  const productMap = new Map(existingProducts.map(p => [p.reference.toLowerCase(), p]));

  return rows.map(r => {
    if (r.status === 'error') return r;
    const product = productMap.get(r.referencia.toLowerCase());
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
