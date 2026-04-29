-- Remision Payments: vincular remisiones gerenciales con pagos reales
-- (transacciones bancarias o movimientos en efectivo) para mostrar el
-- estado real de cobro y la realidad operativa del negocio.
--
-- Una remision puede tener N pagos. Un pago puede ir a N remisiones
-- (con amount_assigned dividiendo). Aplica principalmente a Modo Gerencial
-- pero la tabla no restringe — el modulo decide quien la usa.

CREATE TABLE IF NOT EXISTS public.remision_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remision_id uuid NOT NULL REFERENCES public.remisiones(id) ON DELETE CASCADE,
  payment_kind text NOT NULL CHECK (payment_kind IN ('bank', 'cash')),
  payment_id uuid NOT NULL,
  amount_assigned numeric(14, 2) NOT NULL CHECK (amount_assigned > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remision_payments_remision_idx
  ON public.remision_payments(user_id, remision_id);
CREATE INDEX IF NOT EXISTS remision_payments_payment_idx
  ON public.remision_payments(user_id, payment_kind, payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS remision_payments_unique_link
  ON public.remision_payments(remision_id, payment_kind, payment_id);

COMMENT ON TABLE public.remision_payments IS 'Vincula remisiones con pagos reales (banco o efectivo). payment_id apunta a transactions.id o cash_movements.id segun payment_kind. amount_assigned permite dividir un pago entre multiples remisiones.';

ALTER TABLE public.remision_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "remision_payments_owner_select" ON public.remision_payments;
CREATE POLICY "remision_payments_owner_select"
  ON public.remision_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "remision_payments_owner_insert" ON public.remision_payments;
CREATE POLICY "remision_payments_owner_insert"
  ON public.remision_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "remision_payments_owner_update" ON public.remision_payments;
CREATE POLICY "remision_payments_owner_update"
  ON public.remision_payments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "remision_payments_owner_delete" ON public.remision_payments;
CREATE POLICY "remision_payments_owner_delete"
  ON public.remision_payments FOR DELETE
  USING (auth.uid() = user_id);
