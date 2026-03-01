export interface Invoice {
  id: string;
  user_id: string;
  type: 'venta' | 'compra';
  invoice_number: string;
  prefix: string | null;
  number_int: number | null;
  issue_date: string;
  due_date: string | null;
  counterparty_name: string | null;
  counterparty_nit: string | null;
  seller_name: string | null;
  seller_nit: string | null;
  buyer_name: string | null;
  buyer_nit: string | null;
  city: string | null;
  subtotal_base: number;
  iva_rate: number;
  iva_amount: number;
  total_amount: number;
  autoretefuente_rate: number;
  autoretefuente_amount: number;
  reteica_rate: number;
  reteica_amount: number;
  cufe: string | null;
  payment_method: string | null;
  notes: string | null;
  status: 'draft' | 'confirmed';
  storage_path: string | null;
  pdf_path: string | null;
  extracted_data: any | null;
  confidence_score: number | null;
  display_name: string | null;
  original_filename: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  user_id: string;
  item_code: string | null;
  reference: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_base: number;
  iva_rate: number;
  iva_amount: number;
  line_total: number;
}

export interface InvoiceTransactionMatch {
  id: string;
  invoice_id: string;
  transaction_id: string;
  user_id: string;
  matched_amount: number;
  match_type: 'por_numero' | 'por_monto_fecha' | 'manual';
  created_at: string;
}

export interface TaxSettings {
  id: string;
  user_id: string;
  reteica_rate: number;
  reteica_city: string | null;
  autoretefuente_rate: number;
  retefuente_compra_rate: number;
  is_autorretenedor: boolean;
  created_at: string;
  updated_at: string;
}

// For the AI extraction result before saving
export interface ExtractedInvoiceData {
  invoice_number: string;
  prefix: string;
  number_int: number | null;
  type: 'venta' | 'compra';
  issue_date: string;
  due_date: string | null;
  counterparty_name: string;
  counterparty_nit: string;
  seller_name: string;
  seller_nit: string;
  buyer_name: string;
  buyer_nit: string;
  city: string | null;
  subtotal_base: number;
  iva_rate: number;
  iva_amount: number;
  total_amount: number;
  cufe: string | null;
  payment_method: string | null;
  items: ExtractedInvoiceItem[];
}

export interface ExtractedInvoiceItem {
  item_code: string;
  reference: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_base: number;
  iva_rate: number;
  iva_amount: number;
  line_total: number;
}
