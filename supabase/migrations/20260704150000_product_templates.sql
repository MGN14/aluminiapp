-- ============================================================================
-- Plantillas paramétricas de producto terminado (modelo RA Workshop)
-- ============================================================================
-- product_templates: plantilla por tipo (ventana corrediza N naves, fija,
-- batiente, puerta) con piezas jsonb. Cada pieza referencia un producto del
-- inventario y una fórmula por dimensión:
--   qty = base(formula, ancho, alto) × multiplicador
--   base: ancho→W · alto→H · perimetro→2(W+H) · area→W×H · fijo→1
-- Costo = Σ qty × inventory_products.cost_per_unit (+ desperdicio % sobre
-- piezas dimensionales). Precio = costo × (1 + margen_pct/100).
--
-- NO reemplaza aluminum_catalog_components (BOM por m² de sistema+color):
-- ese modelo es promedio por m²; este es despiece exacto por dimensiones.
--
-- quotation_items se extiende con template_id + template_snapshot para que
-- las líneas cotizadas desde plantilla guarden el despiece congelado y los
-- parámetros del dibujo (tipo, naves, apertura).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  tipo text NOT NULL DEFAULT 'ventana_corrediza'
    CHECK (tipo IN ('ventana_corrediza','ventana_fija','ventana_batiente','puerta_corrediza','puerta_batiente')),
  naves integer NOT NULL DEFAULT 2 CHECK (naves BETWEEN 1 AND 6),
  apertura text NOT NULL DEFAULT 'derecha' CHECK (apertura IN ('izquierda','derecha')),
  system text,
  color text,
  description text,
  margen_pct numeric(5,2) NOT NULL DEFAULT 30 CHECK (margen_pct >= 0),
  desperdicio_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (desperdicio_pct >= 0),
  piezas jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_templates_user_name_uidx
  ON public.product_templates (user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_product_templates_user
  ON public.product_templates(user_id);

ALTER TABLE public.product_templates ENABLE ROW LEVEL SECURITY;

-- RLS con modelo de colaboradores (mismo patrón que aluminum_catalog post
-- 20260520120000_quotations_collab_support).
CREATE POLICY "product_templates_owner_or_collab_select"
  ON public.product_templates FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
CREATE POLICY "product_templates_owner_or_collab_insert"
  ON public.product_templates FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY "product_templates_owner_or_collab_update"
  ON public.product_templates FOR UPDATE TO authenticated
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY "product_templates_owner_or_collab_delete"
  ON public.product_templates FOR DELETE TO authenticated
  USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.product_templates;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.product_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

CREATE TRIGGER update_product_templates_updated_at
  BEFORE UPDATE ON public.product_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- quotation_items: vínculo + snapshot de la plantilla al momento de cotizar
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.product_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_snapshot jsonb;

COMMENT ON TABLE public.product_templates IS 'Plantillas paramétricas de producto terminado (ventana corrediza N naves, fija, batiente, puertas). piezas jsonb: [{product_id, label, formula: ancho|alto|perimetro|area|fijo, multiplicador}]. Costeo en vivo desde inventory_products; precio = costo × (1 + margen_pct/100) con desperdicio_pct sobre piezas dimensionales.';
COMMENT ON COLUMN public.product_templates.piezas IS 'Array jsonb de piezas: {key, product_id (uuid de inventory_products), label, formula (ancho|alto|perimetro|area|fijo), multiplicador (numeric)}. qty = base(formula, W, H) × multiplicador.';
COMMENT ON COLUMN public.product_templates.naves IS 'Cantidad de naves/hojas del producto (corrediza: paños; batiente/puerta: hojas). Solo afecta el dibujo, no las fórmulas.';
COMMENT ON COLUMN public.product_templates.apertura IS 'Sentido de apertura para el dibujo: izquierda o derecha.';
COMMENT ON COLUMN public.quotation_items.template_id IS 'Plantilla paramétrica origen de la línea (null si la línea es del cotizador clásico por m²). ON DELETE SET NULL: la cotización conserva el snapshot.';
COMMENT ON COLUMN public.quotation_items.template_snapshot IS 'Snapshot jsonb congelado al cotizar: despiece con cantidades y costos, margen, desperdicio y parámetros de dibujo (tipo, naves, apertura). Cambios futuros en la plantilla o el inventario no mutan cotizaciones existentes.';
