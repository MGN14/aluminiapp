-- Bug: el frontend de Nueva Remisión insertaba en remision_items solo units
-- y unit_cost, dejando total_cost en su DEFAULT 0. Las páginas de Remisiones
-- y los reportes leen total_cost para mostrar valor por línea y totales —
-- todo aparecía en 0 aunque units * unit_cost calculara bien en el preview.
--
-- Fix en dos partes:
--   1. Trigger BEFORE INSERT/UPDATE que setea total_cost := units * unit_cost
--      siempre. Defensa en profundidad: aunque el frontend olvide enviar
--      total_cost o lo mande inconsistente, el trigger lo corrige.
--   2. Backfill de filas existentes con total_cost = 0 pero units * unit_cost
--      > 0 (la remisión "rem-1" reportada por Nico cae acá).

-- 1. Trigger: total_cost siempre = units * unit_cost
CREATE OR REPLACE FUNCTION public.set_remision_item_total_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_cost := COALESCE(NEW.units, 0) * COALESCE(NEW.unit_cost, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remision_items_set_total_cost ON public.remision_items;
CREATE TRIGGER remision_items_set_total_cost
  BEFORE INSERT OR UPDATE OF units, unit_cost
  ON public.remision_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_remision_item_total_cost();

-- 2. Backfill: filas existentes con total_cost en 0 pero units * unit_cost > 0
UPDATE public.remision_items
SET total_cost = units * unit_cost
WHERE total_cost = 0
  AND units > 0
  AND unit_cost > 0;
