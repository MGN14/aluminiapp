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
  /**
   * FK al responsible (cliente/proveedor) asociado a esta factura.
   * Permite cruzar facturas con movimientos bancarios sin depender del
   * matching por nombre. Si es NULL, se hace fallback ilike sobre counterparty_name.
   */
  responsible_id?: string | null;
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
  /**
   * Estado de validación contra el catálogo público DIAN (vía /validate-cufe).
   * NULL = nunca verificado. Para facturas sin CUFE queda NULL siempre.
   */
  dian_validation_status?: 'validated' | 'not_found' | 'error' | 'pending' | null;
  dian_validated_at?: string | null;
  dian_response?: unknown;
  payment_method: string | null;
  notes: string | null;
  status: 'draft' | 'confirmed' | 'error' | 'uploading' | 'processing' | 'ready';
  /**
   * Anulación por nota crédito. voided_at != null => factura tiene NC asociada
   * en Siigo. void_type='total' => NC iguala el total (factura inválida,
   * excluir de KPIs). void_type='partial' => NC parcial (saldo neto reducido).
   */
  voided_at?: string | null;
  voided_amount?: number | null;
  voided_by_credit_note_id?: string | null;
  voided_by_credit_note_number?: string | null;
  void_type?: 'total' | 'partial' | null;
  source?: 'manual' | 'siigo';
  siigo_id?: string | null;
  storage_path: string | null;
  pdf_path: string | null;
  extracted_data: ExtractedInvoiceData | null;
  confidence_score: number | null;
  display_name: string | null;
  original_filename: string | null;
  processing_error: string | null;
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
  /** Marca cuándo se re-extrajeron los items (re-procesamiento manual). */
  items_reextracted_at?: string;
  /** ID del responsible vinculado durante validación. Persiste para
   *  re-uso si el invoice se reabre desde draft. */
  responsible_id?: string | null;
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
