-- Modulo Creditos: gestion de creditos bancarios y de financiacion
-- con tabla de amortizacion. RLS owner-only.

CREATE TABLE IF NOT EXISTS public.credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  bank_name text,
  principal numeric(14, 2) NOT NULL CHECK (principal > 0),
  interest_rate_monthly numeric(7, 4) NOT NULL CHECK (interest_rate_monthly >= 0),
  term_months integer NOT NULL CHECK (term_months > 0),
  start_date date NOT NULL,
  first_payment_date date NOT NULL,
  amortization_type text NOT NULL DEFAULT 'francesa' CHECK (amortization_type IN ('francesa', 'alemana', 'bullet')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credits_user_status_idx
  ON public.credits(user_id, status);

COMMENT ON TABLE public.credits IS 'Creditos bancarios o de financiacion gestionados por el usuario.';
COMMENT ON COLUMN public.credits.interest_rate_monthly IS 'Tasa mensual nominal en porcentaje (ej. 1.5 = 1.5%/mes). Si tu credito tiene tasa anual, dividila por 12.';
COMMENT ON COLUMN public.credits.amortization_type IS 'francesa = cuota fija, alemana = capital fijo (cuota decreciente), bullet = paga al vencimiento.';

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credits_owner_select" ON public.credits;
CREATE POLICY "credits_owner_select"
  ON public.credits FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "credits_owner_insert" ON public.credits;
CREATE POLICY "credits_owner_insert"
  ON public.credits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "credits_owner_update" ON public.credits;
CREATE POLICY "credits_owner_update"
  ON public.credits FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "credits_owner_delete" ON public.credits;
CREATE POLICY "credits_owner_delete"
  ON public.credits FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_credits_updated_at ON public.credits;
CREATE TRIGGER set_credits_updated_at
  BEFORE UPDATE ON public.credits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Pagos / abonos a creditos
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_id uuid NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount_paid numeric(14, 2) NOT NULL CHECK (amount_paid > 0),
  principal_paid numeric(14, 2) NOT NULL DEFAULT 0,
  interest_paid numeric(14, 2) NOT NULL DEFAULT 0,
  is_extra boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_payments_credit_date_idx
  ON public.credit_payments(credit_id, payment_date DESC);

COMMENT ON TABLE public.credit_payments IS 'Pagos/abonos a creditos. is_extra=true cuando es abono extraordinario fuera del cronograma planeado.';

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_payments_owner_select" ON public.credit_payments;
CREATE POLICY "credit_payments_owner_select"
  ON public.credit_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "credit_payments_owner_insert" ON public.credit_payments;
CREATE POLICY "credit_payments_owner_insert"
  ON public.credit_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "credit_payments_owner_update" ON public.credit_payments;
CREATE POLICY "credit_payments_owner_update"
  ON public.credit_payments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "credit_payments_owner_delete" ON public.credit_payments;
CREATE POLICY "credit_payments_owner_delete"
  ON public.credit_payments FOR DELETE
  USING (auth.uid() = user_id);
