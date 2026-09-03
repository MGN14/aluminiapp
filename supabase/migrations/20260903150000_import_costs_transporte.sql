-- Transporte interno como tipo propio de costo de importación (Nico
-- 2026-09-03): "necesito poder separar aduanas de transporte... es un costo
-- atribuible al aluminio porque sí o sí hay que transportarlo, pero no me
-- quita caja como sí es aduanas, IVA y arancel, que sin eso no puedo sacar
-- el contenedor".
--
-- COSTO sí (prorratea al landed por peso, igual que el flete) — CAJA no
-- (ocurre después de nacionalizar; no bloquea la salida del contenedor).
-- Antes caía en 'nacionalizacion' u 'otro' y se sumaba a la caja para cerrar,
-- inflando lo que había que tener el día del retiro.

ALTER TABLE public.import_costs
  DROP CONSTRAINT IF EXISTS import_costs_tipo_check;

ALTER TABLE public.import_costs
  ADD CONSTRAINT import_costs_tipo_check CHECK (tipo IN (
    'flete', 'seguro', 'arancel', 'iva_importacion',
    'nacionalizacion', 'transporte', 'gastos_bancarios', 'otro'
  ));

COMMENT ON COLUMN public.import_costs.tipo IS
  'flete/seguro = al proveedor (CIF) · arancel/iva_importacion/nacionalizacion = caja para SACAR el contenedor · transporte = costo del aluminio pero posterior a la nacionalización (no pide caja para retirar) · gastos_bancarios/otro = resto.';

NOTIFY pgrst, 'reload schema';
