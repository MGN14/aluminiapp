-- ============================================================================
-- product_aliases: mapeo persistente código de bodega -> código Siigo
-- ============================================================================
-- El conteo físico usa códigos de bodega que NO siempre se derivan algorítmica-
-- mente del código Siigo (ej: DIA31A -> MGN31-5, MN1103 -> MGN1103-5,
-- MN92 -> MN-92). Esta tabla guarda el mapeo que el usuario confirma una vez,
-- para que la próxima subida cruce solo. Cruce: directo -> alias -> maestro ->
-- algorítmico.
--
-- RLS compartida (owner + colaboradores) igual que el resto del inventario.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias text NOT NULL,       -- código que usa bodega en el conteo físico
  ref_siigo text NOT NULL,   -- código canónico del inventario contable (Siigo)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_aliases_user_alias_key UNIQUE (user_id, alias)
);

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy WHERE polrelid = 'public.product_aliases'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.product_aliases', pol.polname);
  END LOOP;
END $$;

CREATE POLICY product_aliases_owner_or_collab_select ON public.product_aliases
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY product_aliases_owner_or_collab_insert ON public.product_aliases
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY product_aliases_owner_or_collab_update ON public.product_aliases
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY product_aliases_owner_or_collab_delete ON public.product_aliases
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

-- Safety net: resuelve el owner en INSERT si el frontend manda user_id propio.
DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.product_aliases;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.product_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

CREATE INDEX IF NOT EXISTS idx_product_aliases_user_alias
  ON public.product_aliases (user_id, lower(alias));
