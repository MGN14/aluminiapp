import type { InventoryProductLite } from '@/hooks/useCatalogComponents';

export type TemplateFormula = 'ancho' | 'alto' | 'perimetro' | 'area' | 'fijo';

export type TemplateTipo =
  | 'ventana_corrediza'
  | 'ventana_fija'
  | 'ventana_batiente'
  | 'puerta_corrediza'
  | 'puerta_batiente';

export type TemplateApertura = 'izquierda' | 'derecha';

export const TIPO_LABELS: Record<TemplateTipo, string> = {
  ventana_corrediza: 'Ventana corrediza',
  ventana_fija: 'Ventana fija',
  ventana_batiente: 'Ventana batiente',
  puerta_corrediza: 'Puerta corrediza',
  puerta_batiente: 'Puerta batiente',
};

export const FORMULA_LABELS: Record<TemplateFormula, string> = {
  ancho: 'Ancho (m)',
  alto: 'Alto (m)',
  perimetro: 'Perímetro (m)',
  area: 'Área (m²)',
  fijo: 'Fijo (unidades)',
};

/** Pieza de la plantilla (elemento del jsonb `piezas`). */
export interface TemplatePiece {
  /** Key local para React (persistida para estabilidad del editor). */
  key: string;
  /** uuid de inventory_products. */
  product_id: string;
  /** Nombre de la pieza en el despiece: "Riel superior", "Jamba", "Vidrio". */
  label: string;
  formula: TemplateFormula;
  multiplicador: number;
}

export interface ProductTemplate {
  id: string;
  user_id: string;
  name: string;
  tipo: TemplateTipo;
  naves: number;
  apertura: TemplateApertura;
  system: string | null;
  color: string | null;
  description: string | null;
  margen_pct: number;
  desperdicio_pct: number;
  piezas: TemplatePiece[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Cantidad base según fórmula: qty = base × multiplicador. */
export function formulaBaseQty(formula: TemplateFormula, widthM: number, heightM: number): number {
  switch (formula) {
    case 'ancho':
      return widthM;
    case 'alto':
      return heightM;
    case 'perimetro':
      return 2 * (widthM + heightM);
    case 'area':
      return widthM * heightM;
    case 'fijo':
      return 1;
  }
}

export interface DespieceLine {
  piece: TemplatePiece;
  product: InventoryProductLite | null;
  /** Cantidad calculada para UNA unidad del producto terminado. */
  qty: number;
  /** Unidad a mostrar (m, m², und según fórmula/producto). */
  unidad: string;
  unitCost: number;
  lineCost: number;
}

export interface DespieceResult {
  lines: DespieceLine[];
  /** Piezas cuyo producto ya no existe/está inactivo en el inventario. */
  missingCount: number;
  areaM2: number;
  /** Σ costo de piezas, sin desperdicio. */
  materialCost: number;
  /** Desperdicio % aplicado solo a piezas dimensionales (no a fórmula 'fijo'). */
  wasteAmount: number;
  costTotal: number;
  /** Precio de venta unitario = costTotal × (1 + margen_pct/100). */
  priceUnit: number;
  pricePerM2: number;
}

function displayUnit(formula: TemplateFormula, product: InventoryProductLite | null): string {
  if (formula === 'area') return 'm²';
  if (formula === 'fijo') return product?.unit?.trim() || 'und';
  return 'm';
}

/**
 * Despiece de UNA unidad del producto terminado a las dimensiones dadas.
 * Costos en vivo desde el inventario (productsById). Piezas sin producto
 * resuelto cuentan como costo 0 y suman en missingCount para avisar en la UI.
 */
export function computeDespiece(
  template: Pick<ProductTemplate, 'piezas' | 'margen_pct' | 'desperdicio_pct'>,
  widthM: number,
  heightM: number,
  productsById: Map<string, InventoryProductLite>,
): DespieceResult {
  const w = Math.max(0, Number(widthM) || 0);
  const h = Math.max(0, Number(heightM) || 0);
  const areaM2 = w * h;

  let materialCost = 0;
  let dimensionalCost = 0;
  let missingCount = 0;

  const lines: DespieceLine[] = (template.piezas ?? []).map((piece) => {
    const product = productsById.get(piece.product_id) ?? null;
    if (!product) missingCount += 1;
    const qty = formulaBaseQty(piece.formula, w, h) * (Number(piece.multiplicador) || 0);
    const unitCost = Number(product?.cost_per_unit ?? 0);
    const lineCost = qty * unitCost;
    materialCost += lineCost;
    if (piece.formula !== 'fijo') dimensionalCost += lineCost;
    return {
      piece,
      product,
      qty: round4(qty),
      unidad: displayUnit(piece.formula, product),
      unitCost,
      lineCost: round2(lineCost),
    };
  });

  const wasteAmount = dimensionalCost * ((Number(template.desperdicio_pct) || 0) / 100);
  const costTotal = materialCost + wasteAmount;
  const priceUnit = costTotal * (1 + (Number(template.margen_pct) || 0) / 100);

  return {
    lines,
    missingCount,
    areaM2: round4(areaM2),
    materialCost: round2(materialCost),
    wasteAmount: round2(wasteAmount),
    costTotal: round2(costTotal),
    priceUnit: round2(priceUnit),
    pricePerM2: areaM2 > 0 ? round2(priceUnit / areaM2) : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Snapshot congelado que guarda quotation_items.template_snapshot al cotizar
 * desde plantilla: despiece + costos del momento y parámetros del dibujo.
 */
export interface TemplateItemSnapshot {
  template_id: string;
  template_name: string;
  tipo: TemplateTipo;
  naves: number;
  apertura: TemplateApertura;
  margen_pct: number;
  desperdicio_pct: number;
  material_cost: number;
  waste_amount: number;
  cost_total: number;
  price_unit: number;
  despiece: Array<{
    label: string;
    reference: string | null;
    formula: TemplateFormula;
    qty: number;
    unidad: string;
    unit_cost: number;
    line_cost: number;
  }>;
}

/** Arma el snapshot a partir del despiece calculado. */
export function buildTemplateSnapshot(
  template: ProductTemplate,
  despiece: DespieceResult,
): TemplateItemSnapshot {
  return {
    template_id: template.id,
    template_name: template.name,
    tipo: template.tipo,
    naves: template.naves,
    apertura: template.apertura,
    margen_pct: Number(template.margen_pct) || 0,
    desperdicio_pct: Number(template.desperdicio_pct) || 0,
    material_cost: despiece.materialCost,
    waste_amount: despiece.wasteAmount,
    cost_total: despiece.costTotal,
    price_unit: despiece.priceUnit,
    despiece: despiece.lines.map((l) => ({
      label: l.piece.label || l.product?.name || '—',
      reference: l.product?.reference ?? null,
      formula: l.piece.formula,
      qty: l.qty,
      unidad: l.unidad,
      unit_cost: l.unitCost,
      line_cost: l.lineCost,
    })),
  };
}
