// ── Column mapping aliases for Siigo and generic formats ──

export const COLUMN_ALIASES: Record<string, string[]> = {
  referencia: ['código producto', 'codigo producto', 'código', 'codigo', 'referencia', 'ref', 'sku', 'code', 'cod'],
  nombre: ['nombre producto', 'producto', 'nombre', 'descripción', 'descripcion', 'name', 'desc'],
  unidad: ['unidad de medida', 'unidad', 'und', 'um', 'unit'],
  sistema: ['sistema', 'system', 'serie', 'línea', 'linea', 'familia', 'grupo'],
  stock: ['total en producto', 'cantidad', 'stock', 'existencia', 'existencias', 'qty', 'saldo'],
  costo_unitario: ['valor unitario aproximado', 'valor unitario', 'costo unitario', 'costo', 'precio compra', 'unit cost'],
  valor_total: ['valor total aproximado', 'valor total', 'total', 'value'],
  precio_venta: ['precio venta', 'precio de venta', 'precio', 'sale price', 'pvp'],
  stock_minimo: ['stock mínimo', 'stock minimo', 'min stock', 'mínimo', 'minimo'],
};

export type MappedField = keyof typeof COLUMN_ALIASES;

export interface ColumnMapping {
  excelHeader: string;
  mappedTo: MappedField | null;
  columnIndex: number;
}

export interface ParsedProduct {
  referencia: string;
  nombre: string;
  unidad: string;
  sistema: string;
  stock: number;
  costo_unitario: number;
  valor_total: number;
  precio_venta: number;
  stock_minimo: number;
  status: 'valid' | 'warning' | 'error';
  issues: string[];
  rowNumber: number;
  isDuplicate?: boolean;
}

export type ImportMode = 'initial' | 'replace' | 'adjust';
export type DuplicateAction = 'sum' | 'replace' | 'skip';

// ── Normalize text for comparison ──
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ── Auto-detect column mapping ──
export function detectColumnMapping(headers: string[]): ColumnMapping[] {
  return headers.map((header, idx) => {
    const norm = normalize(header);
    let bestMatch: MappedField | null = null;

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.some(a => norm === a || norm.includes(a) || a.includes(norm))) {
        bestMatch = field as MappedField;
        break;
      }
    }

    return { excelHeader: header, mappedTo: bestMatch, columnIndex: idx };
  });
}

// ── Parse Colombian number formats: 1.000,50 → 1000.5 ──
export function parseColombianNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (!str) return 0;

  // Remove currency symbols and spaces
  let cleaned = str.replace(/[$\s]/g, '');

  // Detect Colombian format: dots as thousands, comma as decimal
  // e.g. 23.446.157,24
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Fallback: remove commas used as thousands
    cleaned = cleaned.replace(/,/g, '');
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ── Clean and normalize text values ──
function cleanText(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\s+/g, ' ');
}

// ── Build parsed products from raw rows + mapping ──
export function buildProducts(
  rows: unknown[][],
  mapping: ColumnMapping[],
  startRow: number // 1-based row number of first data row
): ParsedProduct[] {
  const getField = (row: unknown[], field: MappedField): unknown => {
    const col = mapping.find(m => m.mappedTo === field);
    if (!col) return undefined;
    return row[col.columnIndex];
  };

  return rows.map((row, i) => {
    const issues: string[] = [];
    const ref = cleanText(getField(row, 'referencia'));
    const nombre = cleanText(getField(row, 'nombre'));
    const unidad = cleanText(getField(row, 'unidad')) || 'unidad';
    const sistema = cleanText(getField(row, 'sistema'));
    const stock = parseColombianNumber(getField(row, 'stock'));
    const costo = parseColombianNumber(getField(row, 'costo_unitario'));
    const valorTotal = parseColombianNumber(getField(row, 'valor_total'));
    const precioVenta = parseColombianNumber(getField(row, 'precio_venta'));
    const stockMin = parseColombianNumber(getField(row, 'stock_minimo'));

    if (!ref) issues.push('Sin referencia');
    if (!nombre) issues.push('Sin nombre');
    if (stock < 0) issues.push('Stock negativo');
    if (costo < 0) issues.push('Costo negativo');

    // Calculate cost from total if not provided
    const finalCosto = costo > 0 ? costo : (stock > 0 && valorTotal > 0 ? valorTotal / stock : 0);

    let status: ParsedProduct['status'] = 'valid';
    if (issues.some(i => i.includes('Sin referencia'))) status = 'error';
    else if (issues.length > 0) status = 'warning';

    return {
      referencia: ref,
      nombre,
      unidad,
      sistema,
      stock,
      costo_unitario: finalCosto,
      valor_total: valorTotal,
      precio_venta: precioVenta,
      stock_minimo: stockMin,
      status,
      issues,
      rowNumber: startRow + i,
    };
  });
}

// ── Mark duplicates ──
export function markDuplicates(products: ParsedProduct[]): ParsedProduct[] {
  const seen = new Map<string, number>();
  return products.map(p => {
    if (!p.referencia) return p;
    const key = p.referencia.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      return { ...p, isDuplicate: true, issues: [...p.issues, 'Referencia duplicada'], status: p.status === 'error' ? 'error' : 'warning' };
    }
    return p;
  });
}

// ── Resolve duplicates ──
export function resolveDuplicates(products: ParsedProduct[], action: DuplicateAction): ParsedProduct[] {
  if (action === 'skip') {
    const seen = new Set<string>();
    return products.filter(p => {
      if (!p.referencia) return true;
      const key = p.referencia.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (action === 'sum') {
    const map = new Map<string, ParsedProduct>();
    for (const p of products) {
      const key = p.referencia?.toLowerCase() || `__empty_${p.rowNumber}`;
      const existing = map.get(key);
      if (existing) {
        existing.stock += p.stock;
        existing.valor_total += p.valor_total;
        existing.isDuplicate = false;
        existing.issues = existing.issues.filter(i => i !== 'Referencia duplicada');
        if (existing.issues.length === 0) existing.status = 'valid';
      } else {
        map.set(key, { ...p, isDuplicate: false, issues: p.issues.filter(i => i !== 'Referencia duplicada') });
      }
    }
    return Array.from(map.values());
  }

  // replace: keep last occurrence
  const map = new Map<string, ParsedProduct>();
  for (const p of products) {
    const key = p.referencia?.toLowerCase() || `__empty_${p.rowNumber}`;
    map.set(key, { ...p, isDuplicate: false, issues: p.issues.filter(i => i !== 'Referencia duplicada') });
  }
  return Array.from(map.values()).map(p => ({
    ...p,
    status: p.issues.length === 0 ? 'valid' : (p.issues.some(i => i.includes('Sin referencia')) ? 'error' : 'warning'),
  }));
}
