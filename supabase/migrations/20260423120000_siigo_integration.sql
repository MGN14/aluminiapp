-- Siigo integration: per-user encrypted credentials + invoice provenance
-- Each user connects their own Siigo account; we pull facturas (venta + compra)
-- into AluminIA so the operator doesn't have to double-key data.

-- 1) Per-user Siigo credentials
CREATE TABLE IF NOT EXISTS public.user_siigo_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  siigo_username text NOT NULL,
  siigo_access_key_encrypted text NOT NULL,
  partner_id text NOT NULL DEFAULT 'aluminiapp',
  connection_status text NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending', 'connected', 'error', 'revoked')),
  last_error text,
  last_sync_at timestamptz,
  last_invoice_pulled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_siigo_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own siigo creds" ON public.user_siigo_credentials;
CREATE POLICY "Users read own siigo creds"
  ON public.user_siigo_credentials FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own siigo creds" ON public.user_siigo_credentials;
CREATE POLICY "Users insert own siigo creds"
  ON public.user_siigo_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own siigo creds" ON public.user_siigo_credentials;
CREATE POLICY "Users update own siigo creds"
  ON public.user_siigo_credentials FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own siigo creds" ON public.user_siigo_credentials;
CREATE POLICY "Users delete own siigo creds"
  ON public.user_siigo_credentials FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_user_siigo_credentials_updated_at ON public.user_siigo_credentials;
CREATE TRIGGER update_user_siigo_credentials_updated_at
  BEFORE UPDATE ON public.user_siigo_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Invoice provenance — distinguish manual uploads vs Siigo pulls,
--    and dedupe Siigo pulls by their canonical id.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'siigo')),
  ADD COLUMN IF NOT EXISTS siigo_id text;

-- One Siigo invoice per user (idempotent re-syncs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_siigo_id
  ON public.invoices (user_id, siigo_id)
  WHERE siigo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_source
  ON public.invoices (user_id, source);

COMMENT ON COLUMN public.invoices.source IS
  'Provenance: manual upload by user, or pulled from Siigo via siigo-sync-invoices.';
COMMENT ON COLUMN public.invoices.siigo_id IS
  'Siigo canonical invoice id; used to dedupe re-syncs. Null for manual uploads.';
