-- ============================================================================
-- Módulo de Cotizaciones de Ventanas (Fase A: cimientos de datos)
-- ============================================================================
-- Tablas:
--   - aluminum_catalog: maestro de sistema/color/precio_m² subido por el usuario
--   - quotations: cotizaciones (cabecera) dirigidas a un responsible (cliente)
--   - quotation_items: ítems de cada cotización con dimensiones y snapshot de precio
-- Extensiones:
--   - responsibles: añadir email/phone/address (necesarios para enviar cotizaciones)
--   - profiles: defaults de cotización (% mano de obra, validez en días, términos)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) aluminum_catalog — maestro de productos por m²
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aluminum_catalog (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  system TEXT NOT NULL,
  color TEXT NOT NULL,
  price_per_m2 NUMERIC(14,2) NOT NULL DEFAULT 0,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evita duplicados de combinación sistema+color por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS aluminum_catalog_user_system_color_uidx
  ON public.aluminum_catalog (user_id, lower(system), lower(color));

CREATE INDEX IF NOT EXISTS idx_aluminum_catalog_user
  ON public.aluminum_catalog(user_id);

ALTER TABLE public.aluminum_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own aluminum catalog"
  ON public.aluminum_catalog FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own aluminum catalog"
  ON public.aluminum_catalog FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own aluminum catalog"
  ON public.aluminum_catalog FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own aluminum catalog"
  ON public.aluminum_catalog FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_aluminum_catalog_updated_at
  BEFORE UPDATE ON public.aluminum_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) quotations — cabecera de cotización
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsible_id UUID NOT NULL REFERENCES public.responsibles(id) ON DELETE RESTRICT,
  quote_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL,
  labor_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  profit_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  subtotal_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  labor_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  sent_email_to TEXT,
  sent_whatsapp_to TEXT,
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  pdf_storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS quotations_user_quote_number_uidx
  ON public.quotations (user_id, quote_number);

CREATE INDEX IF NOT EXISTS idx_quotations_user ON public.quotations(user_id);
CREATE INDEX IF NOT EXISTS idx_quotations_responsible ON public.quotations(responsible_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON public.quotations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quotations_issue_date ON public.quotations(user_id, issue_date DESC);

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own quotations"
  ON public.quotations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own quotations"
  ON public.quotations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own quotations"
  ON public.quotations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own quotations"
  ON public.quotations FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_quotations_updated_at
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) quotation_items — líneas de cotización
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quotation_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  description TEXT,
  system TEXT NOT NULL,
  color TEXT NOT NULL,
  width_m NUMERIC(6,3) NOT NULL,
  height_m NUMERIC(6,3) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  area_m2 NUMERIC(10,4) NOT NULL,
  price_per_m2 NUMERIC(14,2) NOT NULL,
  line_subtotal NUMERIC(14,2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quote
  ON public.quotation_items(quotation_id);

ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

-- RLS via parent (patrón remision_items): el usuario puede ver/editar items
-- solo si es dueño de la cotización padre.
CREATE POLICY "Users can view items of their own quotations"
  ON public.quotation_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id AND q.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert items into their own quotations"
  ON public.quotation_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id AND q.user_id = auth.uid()
  ));

CREATE POLICY "Users can update items of their own quotations"
  ON public.quotation_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id AND q.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete items of their own quotations"
  ON public.quotation_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id AND q.user_id = auth.uid()
  ));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Numeración de cotizaciones — trigger BEFORE INSERT
-- ─────────────────────────────────────────────────────────────────────────────
-- Genera quote_number con formato "COT-YYYY-NNNN" secuencial por usuario y año.
-- Se ejecuta solo si quote_number viene NULL/vacío al insertar (permite que el
-- frontend lo proponga si quiere, pero por defecto lo calcula el server).
CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_max_seq INTEGER;
  v_next_seq INTEGER;
BEGIN
  IF NEW.quote_number IS NOT NULL AND NEW.quote_number <> '' THEN
    RETURN NEW;
  END IF;

  v_year := to_char(COALESCE(NEW.issue_date, CURRENT_DATE), 'YYYY');

  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(quote_number, '^COT-' || v_year || '-', ''), '')::INTEGER
  ), 0)
  INTO v_max_seq
  FROM public.quotations
  WHERE user_id = NEW.user_id
    AND quote_number ~ ('^COT-' || v_year || '-[0-9]+$');

  v_next_seq := v_max_seq + 1;
  NEW.quote_number := 'COT-' || v_year || '-' || lpad(v_next_seq::TEXT, 4, '0');

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_quote_number_before_insert
  BEFORE INSERT ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.generate_quote_number();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Extensión de responsibles — datos de contacto para envío
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Extensión de profiles — defaults de cotización
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quote_labor_pct_default NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_validity_days_default INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS quote_terms_default TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Vista helper — responsibles con flag de "es cliente histórico"
-- ─────────────────────────────────────────────────────────────────────────────
-- Marca como cliente cualquier responsible que tenga al menos UNA invoice
-- de tipo 'venta'. Útil en el frontend para mostrar badge en el dropdown.
CREATE OR REPLACE VIEW public.responsibles_with_sales_flag AS
SELECT
  r.*,
  EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.responsible_id = r.id
      AND i.type = 'venta'
  ) AS has_sales_history
FROM public.responsibles r;

-- La vista hereda el RLS de responsibles (security invoker es default),
-- así que cada usuario solo ve sus propios responsibles.

COMMENT ON TABLE public.aluminum_catalog IS 'Maestro de productos de aluminio: combinación sistema+color con precio por m². Usado como fuente de precios para el módulo de cotizaciones.';
COMMENT ON TABLE public.quotations IS 'Cotizaciones de ventanas/puertas dirigidas a un cliente (responsible). Incluye totales calculados con fórmula compuesta multiplicativa: total = subtotal_base × (1+labor_pct/100) × (1+profit_pct/100).';
COMMENT ON TABLE public.quotation_items IS 'Ítems de cada cotización: dimensiones, sistema, color y snapshot de precio_per_m2 al momento de cotizar.';
COMMENT ON COLUMN public.quotation_items.price_per_m2 IS 'Snapshot del precio del catálogo al momento de crear la cotización. Cambios futuros en aluminum_catalog no mutan cotizaciones existentes.';
