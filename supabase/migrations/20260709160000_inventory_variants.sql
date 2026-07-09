-- Inventario por VARIANTE de color (control interno real, sin la "-5").
--
-- Nico se desprende del -5 para control interno: el -5 (inventory_products)
-- queda SOLO para cuadrar contra lo declarado en Siigo/DIAN. El control real
-- referencia-por-referencia (LIV-40, LIV-40-2, LIV-40-3, LIV-40-0...) vive acá
-- y es la fuente que lee el módulo de Importaciones (cobertura / próximo pedido).
--
-- Flujo (decisión de Nico):
--   · Conteo INICIAL por variante → lo sube Nico (maestra + stock).
--   · Entradas automáticas → packing list nacionalizado (import a 'entregado'),
--     con su costo landed, tomado directo de Importaciones. (Fase 2)
--   · Salidas automáticas → remisiones de venta (la referencia ya trae el
--     sufijo de color tal como se despachó). (Fase 2)
--
-- Patrón RLS nuevo (current_data_owner) para que los colaboradores de bodega
-- lean/escriban el inventario del dueño. NO toca inventory_products.

-- ── Maestra + stock por variante ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_variants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_reference  text NOT NULL,                 -- con sufijo de color (LIV-40-3)
  name               text,                           -- descripción
  system             text,                           -- agrupador (744, Baño, 8025...)
  stock              numeric NOT NULL DEFAULT 0,     -- stock físico actual por variante
  avg_cost           numeric NOT NULL DEFAULT 0,     -- costo landed promedio ponderado
  stock_inicial      numeric,                        -- ancla del conteo inicial
  stock_inicial_date timestamptz,
  last_count_date    timestamptz,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Columnas planas (no lower()) para permitir upsert onConflict al subir la
-- maestra; la app normaliza la referencia (trim + mayúsculas) antes de escribir.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_variants_user_ref_uidx
  ON public.inventory_variants (user_id, variant_reference);

ALTER TABLE public.inventory_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_variants_select ON public.inventory_variants;
DROP POLICY IF EXISTS inventory_variants_insert ON public.inventory_variants;
DROP POLICY IF EXISTS inventory_variants_update ON public.inventory_variants;
DROP POLICY IF EXISTS inventory_variants_delete ON public.inventory_variants;

CREATE POLICY inventory_variants_select ON public.inventory_variants
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY inventory_variants_insert ON public.inventory_variants
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_variants_update ON public.inventory_variants
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
                              WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_variants_delete ON public.inventory_variants
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.inventory_variants;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.inventory_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

DROP TRIGGER IF EXISTS update_inventory_variants_updated_at ON public.inventory_variants;
CREATE TRIGGER update_inventory_variants_updated_at
  BEFORE UPDATE ON public.inventory_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Ledger de movimientos (auditable, recomputable) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_variant_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES public.inventory_variants(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('inicial','entrada','salida','ajuste')),
  quantity      numeric NOT NULL,                    -- unidades (siempre positivo; el tipo da el signo)
  unit_cost     numeric NOT NULL DEFAULT 0,          -- costo landed unitario de la entrada
  source_type   text,                                -- 'inicial' | 'remision' | 'import' | 'manual'
  source_id     uuid,                                -- remision_id / import_id según source_type
  fecha         date NOT NULL DEFAULT current_date,
  nota          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_variant_movements_variant_idx
  ON public.inventory_variant_movements (variant_id);
-- Idempotencia de las entradas automáticas por pedido (no duplicar el packing).
CREATE UNIQUE INDEX IF NOT EXISTS inventory_variant_movements_source_uidx
  ON public.inventory_variant_movements (variant_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.inventory_variant_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_variant_movements_select ON public.inventory_variant_movements;
DROP POLICY IF EXISTS inventory_variant_movements_insert ON public.inventory_variant_movements;
DROP POLICY IF EXISTS inventory_variant_movements_update ON public.inventory_variant_movements;
DROP POLICY IF EXISTS inventory_variant_movements_delete ON public.inventory_variant_movements;

CREATE POLICY inventory_variant_movements_select ON public.inventory_variant_movements
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY inventory_variant_movements_insert ON public.inventory_variant_movements
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_variant_movements_update ON public.inventory_variant_movements
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
                              WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_variant_movements_delete ON public.inventory_variant_movements
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.inventory_variant_movements;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.inventory_variant_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

-- ── Delta atómico de stock por variante (mismo patrón que apply_stock_delta) ─
-- Suma p_delta (puede ser negativo) al stock de la variante, respetando el
-- dueño de los datos. Devuelve el stock resultante.
CREATE OR REPLACE FUNCTION public.apply_variant_stock_delta(p_variant_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := public.current_data_owner();
  v_new   numeric;
BEGIN
  UPDATE public.inventory_variants
     SET stock = COALESCE(stock, 0) + p_delta
   WHERE id = p_variant_id
     AND user_id = v_owner
  RETURNING stock INTO v_new;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_variant_stock_delta(uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_variant_stock_delta(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
