-- Cancelación de créditos: agrega razón + timestamp + columna explícita.
--
-- Caso de uso: usuario refinancia el crédito, llega a un acuerdo con el banco,
-- o cargó el crédito por error. Hoy puede borrar (pierde histórico de pagos)
-- o dejar como `active` (deuda fantasma). Faltaba un estado intermedio:
-- cancelado, con razón documentada y preservando histórico.
--
-- El status `'cancelled'` ya existe en el enum/check del schema; aquí
-- agregamos los campos para documentar el porqué.

ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_credits_status_user
  ON public.credits (user_id, status);

COMMENT ON COLUMN public.credits.cancellation_reason IS
  'Razón del cancelamiento. Categorías sugeridas: refinanciado, acuerdo_pago, error_carga, otro. Free text para flexibilidad.';

COMMENT ON COLUMN public.credits.cancelled_at IS
  'Timestamp del cancelamiento. NULL si nunca fue cancelado.';

NOTIFY pgrst, 'reload schema';
