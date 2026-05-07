export interface AluminumCatalogEntry {
  id: string;
  user_id: string;
  system: string;
  color: string;
  price_per_m2: number;
  description: string | null;
  active: boolean;
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
  total: number;
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
}

export interface QuotationItemDraft {
  description?: string;
  system: string;
  color: string;
  width_m: number;
  height_m: number;
  quantity: number;
  price_per_m2: number;
}

export interface QuotationTotals {
  subtotal_base: number;
  labor_amount: number;
  profit_amount: number;
  total: number;
}

/**
 * Fórmula compuesta multiplicativa:
 *   subtotal_base = SUM(width × height × quantity × price_per_m2)
 *   labor_amount = subtotal_base × (labor_pct / 100)
 *   profit_amount = (subtotal_base + labor_amount) × (profit_pct / 100)
 *   total = subtotal_base + labor_amount + profit_amount
 */
export function computeQuotationTotals(
  items: Pick<QuotationItemDraft, 'width_m' | 'height_m' | 'quantity' | 'price_per_m2'>[],
  laborPct: number,
  profitPct: number,
): QuotationTotals {
  const subtotal_base = items.reduce((acc, it) => {
    const area = (Number(it.width_m) || 0) * (Number(it.height_m) || 0) * (Number(it.quantity) || 0);
    return acc + area * (Number(it.price_per_m2) || 0);
  }, 0);
  const labor_amount = subtotal_base * (laborPct / 100);
  const profit_amount = (subtotal_base + labor_amount) * (profitPct / 100);
  const total = subtotal_base + labor_amount + profit_amount;
  return {
    subtotal_base: round2(subtotal_base),
    labor_amount: round2(labor_amount),
    profit_amount: round2(profit_amount),
    total: round2(total),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
