-- ============================================================================
-- Clasificación fijo / variable de categorías → margen de contribución y
-- punto de equilibrio
-- ============================================================================
-- Cada categoría de egreso se marca como costo 'fijo' (no varía con las ventas:
-- arriendo, nómina admin) o 'variable' (varía con las ventas: costo de
-- mercancía, comisiones, fletes). Si es NULL, la app infiere por report_group
-- (costos_operacionales → variable, gastos_operativos → fijo).

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS cost_behavior text
    CHECK (cost_behavior IN ('fijo', 'variable'));

COMMENT ON COLUMN public.categories.cost_behavior IS
  'Comportamiento del costo para el punto de equilibrio: fijo | variable. NULL = inferir por report_group.';

NOTIFY pgrst, 'reload schema';
