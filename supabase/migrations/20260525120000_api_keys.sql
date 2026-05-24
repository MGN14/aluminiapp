-- Migration: tabla api_keys para MCP server / API pública read-only.
-- Solo el owner ve sus keys. Toda creación/revocación pasa por la edge function
-- `manage-api-keys` (service_role), nunca directo desde el cliente.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Primeros caracteres visibles de la key, e.g. "alm_live_a1b2c3d4".
  -- Sirve para identificar la key en la UI sin guardar el secreto.
  key_prefix TEXT NOT NULL,

  -- SHA-256 hex de la API key completa. Único globalmente.
  key_hash TEXT NOT NULL UNIQUE,

  -- Nombre amigable, p. ej. "Claude Desktop", "Cursor", "Mi script".
  name TEXT NOT NULL,

  -- Futuro: scopes ['read'] | ['read','write']. Por ahora solo 'read'.
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read'],

  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_active_idx
  ON public.api_keys(key_hash) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.api_keys IS 'API keys del usuario para acceso programático (MCP server / REST). Solo lectura por ahora.';
COMMENT ON COLUMN public.api_keys.key_prefix IS 'Primeros chars visibles, e.g. alm_live_a1b2c3d4. NO es secreto.';
COMMENT ON COLUMN public.api_keys.key_hash IS 'SHA-256 hex de la API key completa. Lookup por aquí.';

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- SELECT: el dueño ve sus propias keys.
DROP POLICY IF EXISTS "api_keys_select_own" ON public.api_keys;
CREATE POLICY "api_keys_select_own" ON public.api_keys
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE: bloqueado para el cliente. Todo va por edge function
-- con service_role (que bypassea RLS).
-- No creamos policies de INSERT/UPDATE/DELETE => bloqueado por default.
