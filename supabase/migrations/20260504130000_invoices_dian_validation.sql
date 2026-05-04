-- DIAN validation for invoices.
-- Cada factura con CUFE puede validarse contra el catálogo público DIAN
-- (https://catalogo-vpfe.dian.gov.co/document/searchqr) que devuelve JSON
-- sin auth ni captcha. Cero scraping, cero credenciales del cliente.
--
-- Status semántica:
--   validated   → DIAN confirmó que la factura existe y está validada
--   not_found   → DIAN no encontró el CUFE (puede ser trucha o aún no propagada)
--   error       → falló el request (red, parse, timeout)
--   pending     → no se ha intentado validar todavía

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS dian_validation_status text,
  ADD COLUMN IF NOT EXISTS dian_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dian_response jsonb;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_dian_validation_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_dian_validation_status_check
  CHECK (dian_validation_status IS NULL
    OR dian_validation_status IN ('validated', 'not_found', 'error', 'pending'));

CREATE INDEX IF NOT EXISTS idx_invoices_dian_status
  ON public.invoices (user_id, dian_validation_status)
  WHERE dian_validation_status IS NOT NULL;

COMMENT ON COLUMN public.invoices.dian_validation_status IS
  'Resultado de consulta a catálogo público DIAN por CUFE. NULL = nunca verificado. validated/not_found/error/pending.';
COMMENT ON COLUMN public.invoices.dian_response IS
  'Snapshot del JSON que devolvió DIAN al consultar el CUFE — evidencia para el cliente.';
