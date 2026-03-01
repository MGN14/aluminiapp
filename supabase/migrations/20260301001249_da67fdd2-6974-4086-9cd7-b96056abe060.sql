
-- Tabla de facturas
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  storage_path text,
  invoice_number text NOT NULL,
  prefix text,
  number_int integer,
  type text NOT NULL DEFAULT 'venta' CHECK (type IN ('venta', 'compra')),
  issue_date date NOT NULL,
  due_date date,
  seller_name text,
  seller_nit text,
  buyer_name text,
  buyer_nit text,
  city text,
  subtotal_base numeric NOT NULL DEFAULT 0,
  iva_rate numeric NOT NULL DEFAULT 0.19,
  iva_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  cufe text,
  payment_method text,
  notes text,
  status text NOT NULL DEFAULT 'sin_conciliar' CHECK (status IN ('sin_conciliar', 'parcial', 'conciliada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invoices" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own invoices" ON public.invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own invoices" ON public.invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own invoices" ON public.invoices FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabla de ítems de factura
CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  item_code text,
  reference text,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  line_base numeric NOT NULL DEFAULT 0,
  iva_rate numeric NOT NULL DEFAULT 0.19,
  iva_amount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invoice items" ON public.invoice_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own invoice items" ON public.invoice_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own invoice items" ON public.invoice_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own invoice items" ON public.invoice_items FOR DELETE USING (auth.uid() = user_id);

-- Tabla de conciliación factura-transacción
CREATE TABLE public.invoice_transaction_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  matched_amount numeric NOT NULL DEFAULT 0,
  match_type text NOT NULL DEFAULT 'manual' CHECK (match_type IN ('por_numero', 'por_monto_fecha', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_transaction_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own matches" ON public.invoice_transaction_matches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own matches" ON public.invoice_transaction_matches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own matches" ON public.invoice_transaction_matches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own matches" ON public.invoice_transaction_matches FOR DELETE USING (auth.uid() = user_id);

-- Unique constraint: una transacción solo puede matchear una vez por factura
CREATE UNIQUE INDEX idx_invoice_transaction_unique ON public.invoice_transaction_matches(invoice_id, transaction_id);

-- Tabla de configuración fiscal
CREATE TABLE public.tax_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  reteica_rate numeric NOT NULL DEFAULT 0,
  reteica_city text,
  autoretefuente_rate numeric NOT NULL DEFAULT 0,
  retefuente_compra_rate numeric NOT NULL DEFAULT 0,
  is_autorretenedor boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tax settings" ON public.tax_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own tax settings" ON public.tax_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own tax settings" ON public.tax_settings FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_tax_settings_updated_at BEFORE UPDATE ON public.tax_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket privado para PDFs de facturas
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', false);

CREATE POLICY "Users can upload their own invoices" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own invoices" ON storage.objects FOR SELECT USING (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own invoices" ON storage.objects FOR DELETE USING (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
