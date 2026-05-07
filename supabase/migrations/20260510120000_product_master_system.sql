-- Agregar columna `system` a product_master para alinear con
-- inventory_products.system. El sistema (ej: "744", "8025", "proyectante")
-- es información clave que otros módulos (cotizaciones, remisiones) leen
-- para agrupar referencias y armar fórmulas.
--
-- Sin esto, la plantilla del maestro no podía exportar/importar el sistema
-- y había que llenarlo en otro lado a mano.

ALTER TABLE public.product_master
  ADD COLUMN IF NOT EXISTS system text;

COMMENT ON COLUMN public.product_master.system IS
  'Sistema/línea al que pertenece la referencia (ej: "744", "8025", "proyectante"). Espejo de inventory_products.system para mantener consistencia entre maestro y stock físico.';

CREATE INDEX IF NOT EXISTS idx_product_master_user_system
  ON public.product_master(user_id, system)
  WHERE system IS NOT NULL;
