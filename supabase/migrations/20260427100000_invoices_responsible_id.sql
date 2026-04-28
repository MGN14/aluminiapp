-- Vincula facturas con responsibles (clientes/proveedores) de forma EXPLÍCITA.
--
-- Antes el cruce factura ↔ banco dependía de matching de strings entre
-- invoices.counterparty_name y responsibles.name (case-insensitive ilike).
-- Funciona el 80% de los casos pero falla con abreviaciones, sufijos
-- "S.A.S vs SAS", abreviaciones, errores ortográficos, etc.
--
-- Ahora cada factura puede tener un responsible_id explícito. Se elige al
-- crear/editar la factura desde un dropdown de los responsibles ya
-- existentes (o se crea uno nuevo on-the-fly).
--
-- Las facturas viejas siguen funcionando (responsible_id = NULL → fallback
-- al matching por nombre).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS responsible_id UUID NULL
    REFERENCES public.responsibles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_responsible_id
  ON public.invoices(responsible_id)
  WHERE responsible_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.responsible_id IS
  'FK al responsible (cliente/proveedor) asociado a esta factura. Permite cruzar facturas con movimientos bancarios sin depender del matching por nombre. Si es NULL, se hace fallback ilike sobre counterparty_name.';
