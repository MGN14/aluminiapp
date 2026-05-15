-- Cobros esperados (promesas de pago de clientes).
--
-- Cada fila representa un acuerdo con un cliente sobre cuándo va a pagar y
-- cuánto. Una factura puede tener N promesas (soporta cuotas / pagos
-- parciales). Aparecen en el Dashboard y en el CalendarioMensual para que
-- Nico se acuerde de cobrar. El cumplimiento es manual por ahora (en v2 se
-- puede auto-matchear con ingresos del banco).
CREATE TABLE IF NOT EXISTS public.expected_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- invoice_id es opcional: a veces uno acuerda un pago general con un
  -- cliente que cubre varias facturas o saldo inicial.
  invoice_id uuid NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  -- responsible_id idem opcional pero altamente recomendado para mostrar el
  -- nombre del cliente y filtrar.
  responsible_id uuid NULL REFERENCES public.responsibles(id) ON DELETE SET NULL,
  due_date date NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'cumplido', 'cancelado')),
  notes text NULL,
  -- Cuándo se marcó cumplido (manual). Útil para reportes futuros.
  paid_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expected_payments_user_due_idx
  ON public.expected_payments(user_id, due_date);
CREATE INDEX IF NOT EXISTS expected_payments_user_status_idx
  ON public.expected_payments(user_id, status);
CREATE INDEX IF NOT EXISTS expected_payments_responsible_idx
  ON public.expected_payments(user_id, responsible_id)
  WHERE responsible_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expected_payments_invoice_idx
  ON public.expected_payments(user_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON TABLE public.expected_payments IS
  'Cobros esperados / promesas de pago acordadas con clientes. Una factura puede tener N filas (cuotas).';

-- =============================================================================
-- RLS — owner-only. No hay vista por colaboradores: cada usuario ve solo sus
-- propios cobros esperados.
-- =============================================================================
ALTER TABLE public.expected_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expected_payments_owner_select" ON public.expected_payments;
CREATE POLICY "expected_payments_owner_select"
  ON public.expected_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "expected_payments_owner_insert" ON public.expected_payments;
CREATE POLICY "expected_payments_owner_insert"
  ON public.expected_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "expected_payments_owner_update" ON public.expected_payments;
CREATE POLICY "expected_payments_owner_update"
  ON public.expected_payments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "expected_payments_owner_delete" ON public.expected_payments;
CREATE POLICY "expected_payments_owner_delete"
  ON public.expected_payments FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger updated_at (reusa función existente)
DROP TRIGGER IF EXISTS set_expected_payments_updated_at ON public.expected_payments;
CREATE TRIGGER set_expected_payments_updated_at
  BEFORE UPDATE ON public.expected_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
