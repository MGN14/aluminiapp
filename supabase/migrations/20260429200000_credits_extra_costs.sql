-- Costos adicionales del credito (Fogafin, comision de apertura, seguro,
-- etc.). Se cobran sobre el principal y reducen la rentabilidad efectiva.

ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS additional_costs_pct numeric(7, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_costs_label text;

COMMENT ON COLUMN public.credits.additional_costs_pct IS 'Porcentaje sobre el principal de costos adicionales unicos (Fogafin, comision apertura, seguro). Ej. 4.85 = 4.85%.';
COMMENT ON COLUMN public.credits.additional_costs_label IS 'Descripcion de los costos adicionales. Ej "Seguro Fogafin 4.85% + comision apertura 1%".';
