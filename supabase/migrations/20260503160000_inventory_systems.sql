-- Migration: agregar columna `system` a inventory_products para agrupar
-- referencias por sistema/línea de producto (ej: "744", "8025", "proyectante").
--
-- Cada referencia pertenece a UN sistema (string libre). Permite filtrar y
-- agrupar el catálogo. La columna es opcional — productos sin sistema
-- se muestran en grupo "Sin sistema".

ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS system text;

COMMENT ON COLUMN public.inventory_products.system IS
  'Sistema/grupo al que pertenece la referencia (ej: "744", "8025", "proyectante"). String libre, definido por el usuario. Una referencia pertenece a un solo sistema.';

-- Index para listar sistemas únicos del usuario (para autocomplete) y para
-- filtrar productos por sistema.
CREATE INDEX IF NOT EXISTS idx_inventory_products_user_system
  ON public.inventory_products(user_id, system)
  WHERE system IS NOT NULL;
