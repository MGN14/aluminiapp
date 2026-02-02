-- 1. Create responsibles table
CREATE TABLE public.responsibles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on responsibles
ALTER TABLE public.responsibles ENABLE ROW LEVEL SECURITY;

-- RLS policies for responsibles
CREATE POLICY "Users can view their own responsibles"
  ON public.responsibles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own responsibles"
  ON public.responsibles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own responsibles"
  ON public.responsibles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own responsibles"
  ON public.responsibles FOR DELETE
  USING (auth.uid() = user_id);

-- 2. Create categories table
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- RLS policies for categories
CREATE POLICY "Users can view their own categories"
  ON public.categories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own categories"
  ON public.categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own categories"
  ON public.categories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own categories"
  ON public.categories FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Add new columns to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS iva_rate NUMERIC NOT NULL DEFAULT 0.19,
  ADD COLUMN IF NOT EXISTS iva_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retefuente_rate NUMERIC NOT NULL DEFAULT 0.025,
  ADD COLUMN IF NOT EXISTS retefuente_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.responsibles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_line TEXT;

-- 4. Rename applies_iva to has_iva and applies_retefuente to has_retefuente
ALTER TABLE public.transactions RENAME COLUMN applies_iva TO has_iva;
ALTER TABLE public.transactions RENAME COLUMN applies_retefuente TO has_retefuente;

-- 5. Create function to calculate IVA and retefuente amounts
CREATE OR REPLACE FUNCTION public.calculate_tax_amounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- IVA: only for expenses (negative amounts) when has_iva is true
  IF NEW.has_iva AND NEW.amount IS NOT NULL AND NEW.amount < 0 THEN
    NEW.iva_amount := ABS(NEW.amount) * NEW.iva_rate;
  ELSE
    NEW.iva_amount := 0;
  END IF;

  -- Retefuente: only for expenses (negative amounts) when has_retefuente is true
  IF NEW.has_retefuente AND NEW.amount IS NOT NULL AND NEW.amount < 0 THEN
    NEW.retefuente_amount := ABS(NEW.amount) * NEW.retefuente_rate;
  ELSE
    NEW.retefuente_amount := 0;
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Create trigger for insert and update
CREATE TRIGGER calculate_tax_on_transaction
  BEFORE INSERT OR UPDATE OF amount, has_iva, has_retefuente, iva_rate, retefuente_rate
  ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_tax_amounts();

-- 7. Drop reconciled column (now derived from responsible_id)
ALTER TABLE public.transactions DROP COLUMN IF EXISTS reconciled;

-- 8. Insert default categories for existing users
INSERT INTO public.categories (user_id, name, sort_order)
SELECT DISTINCT user_id, unnest(ARRAY['Ventas', 'Nómina', 'Proveedores', 'Servicios', 'Impuestos', 'Transferencias', 'Gastos Operativos', 'Otros']), 
       generate_series(1, 8)
FROM public.transactions
ON CONFLICT DO NOTHING;