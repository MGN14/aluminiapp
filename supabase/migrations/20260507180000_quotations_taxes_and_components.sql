-- ============================================================================
-- Fase D — Cotizaciones: IVA + retenciones + componentes desde inventario
-- ============================================================================
-- Cambios:
--   1. ALTER quotations: agrega columnas de impuestos y retenciones.
--      - iva_rate / iva_amount / apply_iva    (default 19%, ON)
--      - retefuente_rate / retefuente_amount / apply_retefuente (default OFF)
--      - reteica_rate / reteica_amount / apply_reteica          (default OFF)
--      - total_with_iva: total + iva
--      - total_net:      total con IVA − retenciones (lo que efectivamente
--                        recibe el vendedor en banco)
--      Nota: el campo `total` existente representa el "Total sin IVA"
--      (subtotal_base + labor + profit). No se modifica, solo se suman
--      los nuevos campos a su alrededor.
--
--   2. Nueva tabla `aluminum_catalog_components`: BOM real que vincula un
--      producto del catálogo (aluminum_catalog) con N productos del
--      inventario (inventory_products), con cantidad por m² del producto
--      terminado. Permite saber qué perfiles/vidrios/herrajes componen un
--      "Sistema 744 blanco" sin auto-calcular el precio (que sigue siendo
--      manual en aluminum_catalog.price_per_m2).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ALTER quotations — IVA + retenciones
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS apply_iva BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS iva_rate NUMERIC(6,4) NOT NULL DEFAULT 0.19,
  ADD COLUMN IF NOT EXISTS iva_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apply_retefuente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retefuente_rate NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retefuente_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apply_reteica BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reteica_rate NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reteica_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_with_iva NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_net NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.quotations.total IS
  'Total SIN IVA: subtotal_base + labor_amount + profit_amount. El IVA se suma aparte (total_with_iva) y las retenciones se restan (total_net).';
COMMENT ON COLUMN public.quotations.total_with_iva IS
  'Total + IVA. Es lo que el cliente debe pagar en factura.';
COMMENT ON COLUMN public.quotations.total_net IS
  'Total con IVA menos retenciones (retefuente + reteica). Lo que efectivamente recibe el vendedor en banco si el comprador es agente retenedor.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Nueva tabla aluminum_catalog_components — BOM
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aluminum_catalog_components (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.aluminum_catalog(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  quantity_per_m2 NUMERIC(12,4) NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS aluminum_catalog_components_unique_pair
  ON public.aluminum_catalog_components (catalog_id, product_id);

CREATE INDEX IF NOT EXISTS idx_catalog_components_catalog
  ON public.aluminum_catalog_components(catalog_id);

CREATE INDEX IF NOT EXISTS idx_catalog_components_product
  ON public.aluminum_catalog_components(product_id);

ALTER TABLE public.aluminum_catalog_components ENABLE ROW LEVEL SECURITY;

-- RLS via parent (mismo patrón que quotation_items): el usuario puede ver/editar
-- componentes solo si es dueño del producto del catálogo padre.
CREATE POLICY "Users can view components of their own catalog"
  ON public.aluminum_catalog_components FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.aluminum_catalog c
    WHERE c.id = aluminum_catalog_components.catalog_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert components into their own catalog"
  ON public.aluminum_catalog_components FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.aluminum_catalog c
    WHERE c.id = aluminum_catalog_components.catalog_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users can update components of their own catalog"
  ON public.aluminum_catalog_components FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.aluminum_catalog c
    WHERE c.id = aluminum_catalog_components.catalog_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete components of their own catalog"
  ON public.aluminum_catalog_components FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.aluminum_catalog c
    WHERE c.id = aluminum_catalog_components.catalog_id AND c.user_id = auth.uid()
  ));

CREATE TRIGGER update_catalog_components_updated_at
  BEFORE UPDATE ON public.aluminum_catalog_components
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.aluminum_catalog_components IS
  'Componentes (BOM) de un producto terminado del catálogo. Vincula aluminum_catalog (sistema+color+precio_m²) con inventory_products (perfiles, vidrios, herrajes) y guarda cuánto se consume del producto del inventario por cada m² del producto terminado. El precio_m2 sigue siendo manual en aluminum_catalog — esta tabla es informativa para que el usuario sepa qué compone cada producto y, eventualmente, descuente inventario al aceptar cotizaciones (Fase futura).';
COMMENT ON COLUMN public.aluminum_catalog_components.quantity_per_m2 IS
  'Cantidad del producto del inventario consumida por cada m² del producto terminado. Ej: 2.5 (perfil X de 6m → ~2.5 m por cada m² de ventana 744 blanco).';
