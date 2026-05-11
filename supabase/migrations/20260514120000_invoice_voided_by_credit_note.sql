-- Notas crédito (NC) anulan facturas en Siigo, pero la factura sigue
-- existiendo. La app debe:
--   1. Trackear que una factura fue anulada por NC (total o parcial)
--   2. Excluir las anuladas (totalmente) de KPIs: facturación, IVA, score
--   3. Mostrar el sello "Nota Crédito" en el listado, igual que Siigo
--
-- Estas columnas se popular en la edge function siigo-sync-invoices cuando
-- sincroniza /v1/credit-notes y matchea cada NC con su factura origen.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS voided_by_credit_note_id TEXT,
  ADD COLUMN IF NOT EXISTS voided_by_credit_note_number TEXT,
  ADD COLUMN IF NOT EXISTS void_type TEXT
    CHECK (void_type IN ('total', 'partial'));

COMMENT ON COLUMN public.invoices.voided_at IS
  'Timestamp de cuando se detectó que la factura fue anulada por una nota crédito. NULL = no anulada.';
COMMENT ON COLUMN public.invoices.voided_amount IS
  'Monto total acumulado de NCs aplicadas a esta factura (suma si hay varias NCs parciales).';
COMMENT ON COLUMN public.invoices.voided_by_credit_note_id IS
  'siigo_id de la NC que anula esta factura (la última si hay varias). Para trazabilidad.';
COMMENT ON COLUMN public.invoices.voided_by_credit_note_number IS
  'Número humano de la NC (ej "NC-2-27") para mostrar en UI.';
COMMENT ON COLUMN public.invoices.void_type IS
  'total = NC iguala el monto de la factura (factura efectivamente anulada). partial = NC menor al total (saldo neto). NULL = no anulada.';

CREATE INDEX IF NOT EXISTS idx_invoices_voided
  ON public.invoices(user_id, voided_at)
  WHERE voided_at IS NOT NULL;
