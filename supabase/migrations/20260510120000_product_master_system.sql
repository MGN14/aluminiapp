-- Maestro de productos (product_master): tabla creada originalmente vía
-- Studio en producción. Esta migration es defensiva: la crea si no existe
-- (para entornos limpios o repos sin esa rama de historial) y agrega la
-- columna `system` si falta (para producción donde la tabla ya existía).
--
-- El sistema (ej: "744", "8025", "proyectante") es información clave que
-- otros módulos (cotizaciones, remisiones) leen para agrupar referencias
-- y armar fórmulas. Sin esto, la plantilla del maestro no podía
-- exportar/importar el sistema y había que llenarlo en otro lado a mano.

CREATE TABLE IF NOT EXISTS public.product_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ref_siigo text NOT NULL,
  description text NOT NULL,
  ref_local text,
  ref_proveedor_a text,
  ref_proveedor_b text,
  ref_proveedor_c text,
  unit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_master_user_ref_siigo_key UNIQUE (user_id, ref_siigo)
);

ALTER TABLE public.product_master ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.product_master'::regclass
      AND polname = 'Users manage their own product_master'
  ) THEN
    CREATE POLICY "Users manage their own product_master" ON public.product_master
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

ALTER TABLE public.product_master
  ADD COLUMN IF NOT EXISTS system text;

COMMENT ON COLUMN public.product_master.system IS
  'Sistema/línea al que pertenece la referencia (ej: "744", "8025", "proyectante"). Espejo de inventory_products.system para mantener consistencia entre maestro y stock físico.';

CREATE INDEX IF NOT EXISTS idx_product_master_user_system
  ON public.product_master(user_id, system)
  WHERE system IS NOT NULL;
