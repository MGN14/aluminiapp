-- Ciclo comercial — eslabón cotización → remisión.
--
-- Una remisión puede nacer de una cotización aceptada ("Generar remisión" en
-- el detalle de la cotización). El FK cierra la trazabilidad de punta a punta:
--
--   cotización → remisión (este FK) → factura (remision_invoices, ya existía)
--             → pago (remision_payments / conciliación, ya existía)
--
-- ON DELETE SET NULL: borrar la cotización no arrastra la remisión (el
-- despacho ya ocurrió, el documento queda); solo pierde el origen.
ALTER TABLE public.remisiones
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_remisiones_quotation
  ON public.remisiones(quotation_id) WHERE quotation_id IS NOT NULL;

COMMENT ON COLUMN public.remisiones.quotation_id IS
  'Cotización aceptada de la que nació esta remisión (Generar remisión). NULL = remisión creada a mano/Excel.';

NOTIFY pgrst, 'reload schema';
