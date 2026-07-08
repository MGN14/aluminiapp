-- Packing list enriquecido (formato costeo "Maple" de Nico):
--   color      → los pedidos repiten referencia por color (Mate/Negro/Blanco);
--                conservarlo permite verificar la recepción por color.
--   bultos     → "Bales" del packing list; el total de bultos del contenedor
--                es el dato de control al descargar.
--   costo_unitario_excel → costo unitario COP calculado en el Excel del
--                usuario; se guarda para COMPARAR contra el landed cost que
--                calcula la app (no lo reemplaza — es la vara de verificación).

ALTER TABLE public.import_items
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS bultos numeric,
  ADD COLUMN IF NOT EXISTS costo_unitario_excel numeric;

COMMENT ON COLUMN public.import_items.color IS 'Color del renglon del packing list (Mate/Negro/Blanco/Crudo...)';
COMMENT ON COLUMN public.import_items.bultos IS 'Bultos/bales del renglon - el total del contenedor es el control de descarga';
COMMENT ON COLUMN public.import_items.costo_unitario_excel IS 'Costo unitario COP del Excel del usuario, solo para comparar contra el landed cost calculado';
