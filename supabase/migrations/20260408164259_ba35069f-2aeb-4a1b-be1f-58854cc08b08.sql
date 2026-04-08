
-- Inventory products catalog
CREATE TABLE public.inventory_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  reference TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unidad',
  stock_system NUMERIC NOT NULL DEFAULT 0,
  stock_physical NUMERIC,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  sale_price NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC NOT NULL DEFAULT 0,
  last_count_date TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own inventory products"
  ON public.inventory_products FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own inventory products"
  ON public.inventory_products FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inventory products"
  ON public.inventory_products FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inventory products"
  ON public.inventory_products FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_inventory_products_updated_at
  BEFORE UPDATE ON public.inventory_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Inventory movements (entries, exits, adjustments)
CREATE TABLE public.inventory_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL DEFAULT 'entrada',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  notes TEXT,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own inventory movements"
  ON public.inventory_movements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own inventory movements"
  ON public.inventory_movements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inventory movements"
  ON public.inventory_movements FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inventory movements"
  ON public.inventory_movements FOR DELETE
  USING (auth.uid() = user_id);

-- Inventory physical counts
CREATE TABLE public.inventory_counts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  physical_quantity NUMERIC NOT NULL DEFAULT 0,
  system_quantity NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own inventory counts"
  ON public.inventory_counts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own inventory counts"
  ON public.inventory_counts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inventory counts"
  ON public.inventory_counts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inventory counts"
  ON public.inventory_counts FOR DELETE
  USING (auth.uid() = user_id);

-- Index for performance
CREATE INDEX idx_inventory_products_user ON public.inventory_products(user_id);
CREATE INDEX idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_date ON public.inventory_movements(movement_date);
CREATE INDEX idx_inventory_counts_product ON public.inventory_counts(product_id);
