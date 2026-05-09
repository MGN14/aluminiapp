-- ============================================================================
-- aluminum_catalog: extender producto terminado con datos de fabricación
-- ============================================================================
-- Cambios:
--   1. Nuevas columnas en aluminum_catalog:
--      - lleva_vidrio          boolean   default true
--      - tipo_vidrio           text      free text (templado/crudo/reflectivo/etc)
--      - tiempo_entrega_dias   int       default 0
--      - condiciones           text      texto libre por producto
--      - mano_obra_pct         numeric   override % mano de obra por producto-color
--                                        (null = usa el default global del perfil)
--      - costo_calculado_m2    numeric   snapshot Σ(quantity_per_m2 × cost_per_unit)
--                                        recalculado por trigger al cambiar BOM
--                                        o al cambiar el costo del producto base
--
--   2. Trigger refresh_catalog_cost():
--      - AFTER INSERT/UPDATE/DELETE en aluminum_catalog_components → recalcula
--        costo_calculado_m2 del catalog padre
--      - AFTER UPDATE de inventory_products.cost_per_unit → recalcula
--        costo_calculado_m2 de TODOS los catalogs que usen ese producto
-- ============================================================================

ALTER TABLE public.aluminum_catalog
  ADD COLUMN IF NOT EXISTS lleva_vidrio        boolean    NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tipo_vidrio         text,
  ADD COLUMN IF NOT EXISTS tiempo_entrega_dias int        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS condiciones         text,
  ADD COLUMN IF NOT EXISTS mano_obra_pct       numeric(5,2),
  ADD COLUMN IF NOT EXISTS costo_calculado_m2  numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.aluminum_catalog.lleva_vidrio IS 'Si false, el producto terminado no incluye vidrio (ej: marco fijo sin paño). UI esconde tipo_vidrio.';
COMMENT ON COLUMN public.aluminum_catalog.tipo_vidrio IS 'Tipo de vidrio (texto libre): "templado 6mm", "crudo 4mm", "reflectivo bronce 6mm", etc.';
COMMENT ON COLUMN public.aluminum_catalog.tiempo_entrega_dias IS 'Tiempo de entrega típico de este producto en días hábiles. Se sugiere en cotización pero el usuario puede sobreescribir.';
COMMENT ON COLUMN public.aluminum_catalog.condiciones IS 'Condiciones específicas de este producto (ej: anticipo del 50%, tiempo de instalación, garantía). Texto libre. Se sugiere en cotización.';
COMMENT ON COLUMN public.aluminum_catalog.mano_obra_pct IS 'Override del % mano de obra para este producto-color específico. NULL = usa el default global del perfil (profiles.quote_labor_pct_default).';
COMMENT ON COLUMN public.aluminum_catalog.costo_calculado_m2 IS 'Costo real por m² calculado automáticamente como Σ(componente.quantity_per_m2 × inventory_products.cost_per_unit). Refrescado por trigger refresh_catalog_cost cada vez que cambia el BOM o el costo del producto base.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Function: recalcular costo_calculado_m2 para un set de catalog_ids
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_catalog_cost(p_catalog_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.aluminum_catalog c
  SET costo_calculado_m2 = COALESCE(sub.total, 0)
  FROM (
    SELECT comp.catalog_id,
           SUM(comp.quantity_per_m2 * COALESCE(ip.cost_per_unit, 0)) AS total
    FROM public.aluminum_catalog_components comp
    LEFT JOIN public.inventory_products ip ON ip.id = comp.product_id
    WHERE comp.catalog_id = ANY(p_catalog_ids)
    GROUP BY comp.catalog_id
  ) sub
  WHERE c.id = sub.catalog_id;

  -- Catalogs sin componentes quedan en 0 (LEFT JOIN no devolveria fila).
  UPDATE public.aluminum_catalog c
  SET costo_calculado_m2 = 0
  WHERE c.id = ANY(p_catalog_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.aluminum_catalog_components comp
      WHERE comp.catalog_id = c.id
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 1: cambio en components → recalcula el catalog padre
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_refresh_catalog_cost_from_components()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_catalog uuid;
BEGIN
  affected_catalog := COALESCE(NEW.catalog_id, OLD.catalog_id);
  PERFORM public.recompute_catalog_cost(ARRAY[affected_catalog]);
  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS refresh_catalog_cost_on_components ON public.aluminum_catalog_components;
CREATE TRIGGER refresh_catalog_cost_on_components
  AFTER INSERT OR UPDATE OR DELETE ON public.aluminum_catalog_components
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_catalog_cost_from_components();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 2: cambio en inventory_products.cost_per_unit → recalcula todos los
-- catalogs que usen ese producto
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_refresh_catalog_cost_from_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected uuid[];
BEGIN
  IF NEW.cost_per_unit IS DISTINCT FROM OLD.cost_per_unit THEN
    SELECT array_agg(DISTINCT catalog_id)
    INTO affected
    FROM public.aluminum_catalog_components
    WHERE product_id = NEW.id;

    IF affected IS NOT NULL AND array_length(affected, 1) > 0 THEN
      PERFORM public.recompute_catalog_cost(affected);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS refresh_catalog_cost_on_inventory_cost ON public.inventory_products;
CREATE TRIGGER refresh_catalog_cost_on_inventory_cost
  AFTER UPDATE OF cost_per_unit ON public.inventory_products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_catalog_cost_from_inventory();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: poblar costo_calculado_m2 para catalogs existentes que ya tienen BOM
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM public.aluminum_catalog;
  IF ids IS NOT NULL AND array_length(ids, 1) > 0 THEN
    PERFORM public.recompute_catalog_cost(ids);
  END IF;
END $$;
