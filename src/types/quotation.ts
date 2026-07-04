import type { TemplateItemSnapshot } from '@/types/productTemplate';

export interface AluminumCatalogEntry {
  id: string;
  user_id: string;
  system: string;
  color: string;
  /** Precio de venta sugerido por m² (manual). Si no se setea, la cotización lo calcula desde costo + márgenes. */
  price_per_m2: number;
  description: string | null;
  active: boolean;
  /** Si true, el producto incluye vidrio en su BOM. */
  lleva_vidrio: boolean;
  /** Texto libre: "templado 6mm", "crudo 4mm", "reflectivo bronce", etc. */
  tipo_vidrio: string | null;
  /** Tiempo de entrega típico en días hábiles. */
  tiempo_entrega_dias: number;
  /** Condiciones específicas (anticipo, garantía, instalación). */
  condiciones: string | null;
  /** Override % mano de obra para este producto-color. NULL = usa default global del perfil. */
  mano_obra_pct: number | null;
  /** Costo real calculado por m² (Σ componentes × costo unitario). Auto-actualizado por trigger. */
  costo_calculado_m2: number;
  created_at: string;
  updated_at: string;
}

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface Quotation {
  id: string;
  user_id: string;
  responsible_id: string;
  quote_number: string;
  status: QuotationStatus;
  issue_date: string;
  valid_until: string;
  labor_pct: number;
  profit_pct: number;
  subtotal_base: number;
  labor_amount: number;
  profit_amount: number;
  /** Total SIN IVA: subtotal_base + labor_amount + profit_amount. */
  total: number;
  // Impuestos y retenciones
  apply_iva: boolean;
  iva_rate: number;
  iva_amount: number;
  apply_retefuente: boolean;
  retefuente_rate: number;
  retefuente_amount: number;
  apply_reteica: boolean;
  reteica_rate: number;
  reteica_amount: number;
  /** total + iva_amount */
  total_with_iva: number;
  /** total_with_iva − retefuente_amount − reteica_amount */
  total_net: number;
  notes: string | null;
  sent_email_to: string | null;
  sent_whatsapp_to: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  pdf_storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationItem {
  id: string;
  quotation_id: string;
  description: string | null;
  system: string;
  color: string;
  width_m: number;
  height_m: number;
  quantity: number;
  area_m2: number;
  price_per_m2: number;
  line_subtotal: number;
  sort_order: number;
  created_at: string;
  /** Plantilla paramétrica origen (null en líneas del cotizador clásico por m²). */
  template_id?: string | null;
  /** Despiece + parámetros de dibujo congelados al momento de cotizar. */
  template_snapshot?: TemplateItemSnapshot | null;
}

export interface QuotationItemDraft {
  description?: string;
  system: string;
  color: string;
  width_m: number;
  height_m: number;
  quantity: number;
  price_per_m2: number;
  template_id?: string | null;
  template_snapshot?: TemplateItemSnapshot | null;
}

export interface QuotationTotals {
  subtotal_base: number;
  labor_amount: number;
  profit_amount: number;
  total: number;
  iva_amount: number;
  retefuente_amount: number;
  reteica_amount: number;
  total_with_iva: number;
  total_net: number;
}

export interface QuotationTaxParams {
  apply_iva: boolean;
  iva_rate: number; // como decimal (0.19 = 19%)
  apply_retefuente: boolean;
  retefuente_rate: number;
  apply_reteica: boolean;
  reteica_rate: number;
}

/**
 * Fórmula compuesta multiplicativa:
 *   subtotal_base   = SUM(width × height × quantity × price_per_m2)
 *   labor_amount    = subtotal_base × labor_pct/100
 *   profit_amount   = (subtotal_base + labor_amount) × profit_pct/100
 *   total           = subtotal_base + labor_amount + profit_amount  (sin IVA)
 *   iva_amount      = total × iva_rate                              (si apply_iva)
 *   total_with_iva  = total + iva_amount
 *   retefuente      = total × retefuente_rate                       (si apply_retefuente)
 *   reteica         = total × reteica_rate                          (si apply_reteica)
 *   total_net       = total_with_iva − retefuente − reteica
 *
 * Nota: las retenciones se calculan sobre el total sin IVA (base gravable),
 * que es el patrón colombiano estándar para cotizaciones.
 */
export function computeQuotationTotals(
  items: Pick<QuotationItemDraft, 'width_m' | 'height_m' | 'quantity' | 'price_per_m2'>[],
  laborPct: number,
  profitPct: number,
  taxes: QuotationTaxParams = {
    apply_iva: false,
    iva_rate: 0,
    apply_retefuente: false,
    retefuente_rate: 0,
    apply_reteica: false,
    reteica_rate: 0,
  },
): QuotationTotals {
  const subtotal_base = items.reduce((acc, it) => {
    const area = (Number(it.width_m) || 0) * (Number(it.height_m) || 0) * (Number(it.quantity) || 0);
    return acc + area * (Number(it.price_per_m2) || 0);
  }, 0);
  const labor_amount = subtotal_base * (laborPct / 100);
  const profit_amount = (subtotal_base + labor_amount) * (profitPct / 100);
  const total = subtotal_base + labor_amount + profit_amount;

  const iva_amount = taxes.apply_iva ? total * (Number(taxes.iva_rate) || 0) : 0;
  const total_with_iva = total + iva_amount;
  const retefuente_amount = taxes.apply_retefuente
    ? total * (Number(taxes.retefuente_rate) || 0)
    : 0;
  const reteica_amount = taxes.apply_reteica ? total * (Number(taxes.reteica_rate) || 0) : 0;
  const total_net = total_with_iva - retefuente_amount - reteica_amount;

  return {
    subtotal_base: round2(subtotal_base),
    labor_amount: round2(labor_amount),
    profit_amount: round2(profit_amount),
    total: round2(total),
    iva_amount: round2(iva_amount),
    retefuente_amount: round2(retefuente_amount),
    reteica_amount: round2(reteica_amount),
    total_with_iva: round2(total_with_iva),
    total_net: round2(total_net),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
