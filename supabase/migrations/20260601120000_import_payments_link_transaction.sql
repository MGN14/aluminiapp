-- Vincular abonos de importaciones con transactions bancarias reales.
-- Relación 1:1 — cada transferencia al exterior es UN abono.
-- transaction_id es opcional: permite registrar abonos sin transaction asociada
-- (e.g. anticipos en efectivo, retroactivos) pero cuando la tx existe se vincula.

ALTER TABLE public.import_payments
  ADD COLUMN IF NOT EXISTS transaction_id uuid NULL REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS import_payments_transaction_idx
  ON public.import_payments(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Evitar que la misma transaction se vincule a 2+ abonos distintos
CREATE UNIQUE INDEX IF NOT EXISTS import_payments_transaction_unique
  ON public.import_payments(transaction_id)
  WHERE transaction_id IS NOT NULL;

COMMENT ON COLUMN public.import_payments.transaction_id IS
  'FK opcional a transactions. Cuando el abono corresponde a una transferencia bancaria real, se vincula acá. UNIQUE: una tx solo puede ser un abono.';
