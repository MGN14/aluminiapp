-- DIAN integration: per-user encrypted MUISCA credentials + verification snapshots + alerts.
-- Pattern adapted from user_siigo_credentials (20260423120000_siigo_integration.sql).
--
-- Goal: AluminIA logs into MUISCA on behalf of the client via Browserless,
-- pulls public-facing fiscal data (RUT, declaraciones, exógena, calendario),
-- contrasts vs Siigo data already in AluminIA, surfaces discrepancies as alerts.

-- 1) Per-user MUISCA credentials (cifrado AES-GCM con DIAN_ENCRYPTION_KEY)
CREATE TABLE IF NOT EXISTS public.user_dian_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Login form data (mirrors MUISCA "A nombre de un tercero" flow)
  nit text NOT NULL,
  rl_doc_type text NOT NULL,
  rl_doc_number text NOT NULL,
  muisca_password_encrypted text NOT NULL,
  -- State
  connection_status text NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending', 'connected', 'error', 'revoked')),
  last_error text,
  last_login_at timestamptz,
  last_verification_at timestamptz,
  -- Proactive alerts opt-in
  proactive_alerts_enabled boolean NOT NULL DEFAULT true,
  consent_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_dian_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own dian creds" ON public.user_dian_credentials;
CREATE POLICY "Users read own dian creds"
  ON public.user_dian_credentials FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own dian creds" ON public.user_dian_credentials;
CREATE POLICY "Users insert own dian creds"
  ON public.user_dian_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own dian creds" ON public.user_dian_credentials;
CREATE POLICY "Users update own dian creds"
  ON public.user_dian_credentials FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own dian creds" ON public.user_dian_credentials;
CREATE POLICY "Users delete own dian creds"
  ON public.user_dian_credentials FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_user_dian_credentials_updated_at ON public.user_dian_credentials;
CREATE TRIGGER update_user_dian_credentials_updated_at
  BEFORE UPDATE ON public.user_dian_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Verification snapshots — JSON timestamped, evidencia para el cliente
CREATE TABLE IF NOT EXISTS public.dian_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verification_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'warning', 'discrepancy', 'error')),
  raw_data jsonb,
  summary jsonb,
  cross_check jsonb,
  triggered_by text NOT NULL DEFAULT 'manual'
    CHECK (triggered_by IN ('manual', 'proactive')),
  duration_ms integer,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dian_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own verifications" ON public.dian_verifications;
CREATE POLICY "Users read own verifications"
  ON public.dian_verifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_dian_verifications_user_type_date
  ON public.dian_verifications (user_id, verification_type, created_at DESC);

-- 3) Alerts: cosas accionables que el contador debería resolver
CREATE TABLE IF NOT EXISTS public.dian_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verification_id uuid REFERENCES public.dian_verifications(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  description text NOT NULL,
  recommended_action text,
  -- Para deduping al re-verificar el mismo problema
  alert_key text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dian_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own alerts" ON public.dian_alerts;
CREATE POLICY "Users read own alerts"
  ON public.dian_alerts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own alerts" ON public.dian_alerts;
CREATE POLICY "Users update own alerts"
  ON public.dian_alerts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dian_alerts_user_key_open
  ON public.dian_alerts (user_id, alert_key)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_dian_alerts_user_status
  ON public.dian_alerts (user_id, status, severity, created_at DESC);

DROP TRIGGER IF EXISTS update_dian_alerts_updated_at ON public.dian_alerts;
CREATE TRIGGER update_dian_alerts_updated_at
  BEFORE UPDATE ON public.dian_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.user_dian_credentials IS
  'Credenciales del cliente para portal MUISCA, cifradas con DIAN_ENCRYPTION_KEY. Se usan server-side para login automatizado vía Browserless.';
COMMENT ON TABLE public.dian_verifications IS
  'Snapshots de verificaciones contra DIAN. Cada fila = una consulta a una pantalla de MUISCA + cross-check vs Siigo.';
COMMENT ON TABLE public.dian_alerts IS
  'Alertas accionables generadas a partir de verificaciones. alert_key permite re-detectar el mismo problema sin duplicar.';
