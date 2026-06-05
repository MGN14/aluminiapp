-- ============================================================================
-- Maestro de productos: histórico compartido + auto-acumulación
-- ============================================================================
-- BUG: `product_master` (Maestro de productos) aparecía VACÍO aunque ya se
-- habían subido inventarios. Dos causas, ambas reales:
--
--  1) RLS estricta. La tabla se creó vía Studio DESPUÉS de la migración de
--     colaboradores (20260507120000), que la saltó por no existir todavía.
--     Quedó con `auth.uid() = user_id` en vez del patrón compartido
--     `current_data_owner()` que usa el resto del inventario. → lo cargado por
--     un colaborador (o por otra cuenta) quedaba invisible para el owner.
--
--  2) Sin puente inventario → maestro. Subir inventario solo escribe en
--     `inventory_products`; nada poblaba `product_master`. Un maestro es
--     histórico por diseño: debe acumular automáticamente, no cargarse a mano.
--
-- Esta migración es IDEMPOTENTE y NO DESTRUCTIVA (no borra datos de negocio):
--   A. Patrón compartido (owner + colaboradores) en product_master.
--   B. Repunta filas huérfanas (cargadas por un colaborador) al owner.
--   C. Backfill del maestro desde inventory_products ya cargado.
--   D. Trigger que acumula cada nueva referencia de inventario al maestro.
-- ============================================================================

-- Blindaje: garantizar la columna `system` en ambas tablas (algunas se crearon
-- vía Studio; ADD COLUMN IF NOT EXISTS es no-op si ya existe).
ALTER TABLE public.inventory_products ADD COLUMN IF NOT EXISTS system text;
ALTER TABLE public.product_master      ADD COLUMN IF NOT EXISTS system text;

-- Blindaje: garantizar el UNIQUE (user_id, ref_siigo) que necesita ON CONFLICT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_master_user_ref_siigo_key'
      AND conrelid = 'public.product_master'::regclass
  ) THEN
    ALTER TABLE public.product_master
      ADD CONSTRAINT product_master_user_ref_siigo_key UNIQUE (user_id, ref_siigo);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- A. RLS compartida (espejo de las demás tablas de inventario)
-- ----------------------------------------------------------------------------
DO $$
DECLARE pol RECORD;
BEGIN
  -- Drop de TODAS las policies actuales (nombres heterogéneos: la estricta
  -- "Users manage their own product_master" y/o restos de Studio).
  FOR pol IN
    SELECT polname FROM pg_policy WHERE polrelid = 'public.product_master'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.product_master', pol.polname);
  END LOOP;
END $$;

CREATE POLICY product_master_owner_or_collab_select ON public.product_master
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY product_master_owner_or_collab_insert ON public.product_master
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY product_master_owner_or_collab_update ON public.product_master
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY product_master_owner_or_collab_delete ON public.product_master
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

-- Safety net: si el frontend olvida resolver el owner, el trigger lo corrige.
DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.product_master;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.product_master
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

ALTER TABLE public.product_master ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- B. Repuntar filas huérfanas: maestro cargado bajo un colaborador → al owner.
--    Solo las que NO colisionan con una ref ya existente del owner (evita
--    violar el UNIQUE). Las que colisionan se quedan donde están (inofensivas).
--    NO se borra nada.
-- ----------------------------------------------------------------------------
UPDATE public.product_master pm
SET user_id = c.owner_user_id
FROM public.collaborators c
WHERE pm.user_id = c.collaborator_user_id
  AND c.status NOT IN ('revoked', 'deleted')
  AND NOT EXISTS (
    SELECT 1 FROM public.product_master o
    WHERE o.user_id = c.owner_user_id AND o.ref_siigo = pm.ref_siigo
  );

-- ----------------------------------------------------------------------------
-- C. Backfill: traer al maestro todo lo que ya está en inventory_products.
--    user_id se copia tal cual (ya es el owner por el patrón compartido del
--    inventario), así queda visible para owner + colaboradores.
--    ref_siigo = reference verbatim (consistente con el dedup del frontend).
-- ----------------------------------------------------------------------------
INSERT INTO public.product_master (user_id, ref_siigo, description, unit, system, active)
SELECT DISTINCT ON (ip.user_id, ip.reference)
  ip.user_id,
  ip.reference,
  COALESCE(NULLIF(btrim(ip.name), ''), ip.reference) AS description,
  COALESCE(NULLIF(btrim(ip.unit), ''), 'und')        AS unit,
  ip.system,
  true
FROM public.inventory_products ip
WHERE ip.reference IS NOT NULL AND btrim(ip.reference) <> ''
ORDER BY ip.user_id, ip.reference, ip.updated_at DESC
ON CONFLICT (user_id, ref_siigo) DO NOTHING;

-- ----------------------------------------------------------------------------
-- D. Auto-acumulación: cada nueva referencia de inventario entra al maestro.
--    ON CONFLICT DO NOTHING → nunca pisa el enriquecimiento manual (ref_local,
--    proveedores, sistema editado a mano). Cubre los 3 caminos de carga
--    (bulk upload, Siigo sync, conteo físico): todos insertan en inventory_products.
--    SECURITY DEFINER para que corra aunque el insertador sea un colaborador.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_inventory_to_product_master()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.product_master (user_id, ref_siigo, description, unit, system, active)
  VALUES (
    NEW.user_id,
    NEW.reference,
    COALESCE(NULLIF(btrim(NEW.name), ''), NEW.reference),
    COALESCE(NULLIF(btrim(NEW.unit), ''), 'und'),
    NEW.system,
    true
  )
  ON CONFLICT (user_id, ref_siigo) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_inventory_to_product_master_trg ON public.inventory_products;
CREATE TRIGGER sync_inventory_to_product_master_trg
  AFTER INSERT ON public.inventory_products
  FOR EACH ROW EXECUTE FUNCTION public.sync_inventory_to_product_master();
