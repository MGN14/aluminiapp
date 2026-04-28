-- Pagos recurrentes con Wompi Tokens de Pago.
--
-- Wompi NO tiene un producto "Subscriptions" como Stripe. La forma de cobrar
-- mensualmente es:
--   1. La primera vez el cliente paga normal en Wompi Checkout y nos manda
--      un payment_source_id (token de la tarjeta tokenizada).
--   2. Guardamos ese token en user_payment_methods (no la tarjeta — eso lo
--      guarda Wompi cifrado).
--   3. Una edge function programada (cron diario) busca subscriptions que
--      vencen y dispara un POST /transactions a Wompi con el token.
--   4. Si falla, registra el intento y reintenta a los 3 días.
--
-- Tablas:
--   user_payment_methods: token activo del cliente (1 por user_id).
--   subscription_charges: log de cada intento de cobro recurrente.

-- =====================================================================
-- user_payment_methods
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.user_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Token de Wompi. Devuelto cuando el cliente paga la primera vez con
  -- single_use=false. Se usa en POST /transactions para cobros futuros.
  wompi_payment_source_id text NOT NULL,
  wompi_customer_email text,

  -- Para mostrar en la UI ("**** 4242 · Visa") sin guardar la tarjeta real.
  card_last_four text,
  card_brand text,
  card_exp_month int,
  card_exp_year int,

  -- 'active' | 'invalid' (token rechazado por Wompi) | 'revoked' (cliente eliminó)
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_status
  ON public.user_payment_methods (status, user_id);

ALTER TABLE public.user_payment_methods ENABLE ROW LEVEL SECURITY;

-- El cliente lee y borra su propio método (cancelar suscripción = borrar token)
CREATE POLICY "users_read_own_payment_method"
  ON public.user_payment_methods FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_payment_method"
  ON public.user_payment_methods FOR DELETE
  USING (auth.uid() = user_id);

-- INSERT y UPDATE solo via edge function (service role) — no queremos que
-- el cliente pueda inyectar tokens manualmente.

COMMENT ON TABLE public.user_payment_methods IS
  'Token de Wompi para cobros recurrentes. 1 por user_id. Se carga via wompi-webhook tras primer pago exitoso. Para cancelar suscripción, borrar la fila.';

-- =====================================================================
-- subscription_charges
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.subscription_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES public.user_payment_methods(id) ON DELETE SET NULL,

  -- Plan que se intentó cobrar
  plan text NOT NULL,
  amount_in_cents bigint NOT NULL,

  -- Estado del intento: 'pending' (creado, esperando respuesta), 'success',
  -- 'failed' (Wompi rechazó), 'error' (excepción técnica nuestra)
  status text NOT NULL,
  attempt_number int NOT NULL DEFAULT 1,

  -- Identificadores Wompi
  wompi_transaction_id text,
  wompi_status text,
  wompi_status_message text,

  attempted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charges_user_time
  ON public.subscription_charges (user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_charges_status_time
  ON public.subscription_charges (status, attempted_at DESC);

ALTER TABLE public.subscription_charges ENABLE ROW LEVEL SECURITY;

-- El cliente puede ver su historial de cobros
CREATE POLICY "users_read_own_charges"
  ON public.subscription_charges FOR SELECT
  USING (auth.uid() = user_id);

-- El founder ve todo (mismo patrón que app_events)
CREATE POLICY "founder_reads_all_charges"
  ON public.subscription_charges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND lower(email) = 'niko14_gomez@hotmail.com'
    )
  );

COMMENT ON TABLE public.subscription_charges IS
  'Log de intentos de cobro recurrente vía Wompi. Se inserta antes de llamar a la API y se actualiza con status post-respuesta.';

-- =====================================================================
-- Trigger updated_at en user_payment_methods
-- =====================================================================
DROP TRIGGER IF EXISTS trg_payment_methods_updated_at ON public.user_payment_methods;

CREATE TRIGGER trg_payment_methods_updated_at
  BEFORE UPDATE ON public.user_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
