-- ============================================================================
-- inventory_locations: stock por UBICACIÓN (bin) por referencia.
-- ============================================================================
-- Una misma referencia puede estar repartida en varias ubicaciones de bodega
-- (ej: SA325B → 30 en A1, 180 en C3). Esta tabla guarda cuánto hay en cada bin.
-- La suma de cantidades por referencia debe cuadrar con su stock físico.
--
-- Es la base del PICKING DIRIGIDO paso a paso: para despachar un pedido, la app
-- usa este mapa para decir "andá a A1, tomá 30; después a C3, tomá 10".
--
-- RLS compartida (owner + colaboradores) igual que el resto del inventario.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  location text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_locations_unique UNIQUE (user_id, product_id, location)
);

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.inventory_locations'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.inventory_locations', pol.polname); END LOOP;
END $$;

CREATE POLICY inventory_locations_select ON public.inventory_locations
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY inventory_locations_insert ON public.inventory_locations
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_locations_update ON public.inventory_locations
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_locations_delete ON public.inventory_locations
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

-- Safety net: resuelve el owner en INSERT si el frontend manda user_id propio
-- (caso colaborador, igual que remisiones / product_aliases).
DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.inventory_locations;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

CREATE INDEX IF NOT EXISTS idx_inventory_locations_product ON public.inventory_locations (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_loc ON public.inventory_locations (user_id, lower(location));

NOTIFY pgrst, 'reload schema';
