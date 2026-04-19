-- Track failed login attempts for rate limiting + forensics.
-- An attempt is uniquely identified by (email, ip) tuple within the window.
-- Rows are retained for 30 days for auditing; rate-limit logic only looks at
-- the last 10 minutes.

CREATE TABLE IF NOT EXISTS public.auth_failed_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT,
  reason TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_failed_attempts_email_ip_time
  ON public.auth_failed_attempts (email, ip, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_failed_attempts_attempted_at
  ON public.auth_failed_attempts (attempted_at DESC);

-- RLS: only the service role may read/write. Regular users (anon/authenticated)
-- must never touch this table directly.
ALTER TABLE public.auth_failed_attempts ENABLE ROW LEVEL SECURITY;

-- Intentionally NO policies are created for anon or authenticated roles.
-- The edge function uses the service role key and bypasses RLS.

-- Cleanup helper: can be called from a scheduled task to prune old rows.
CREATE OR REPLACE FUNCTION public.prune_old_auth_failed_attempts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.auth_failed_attempts
  WHERE attempted_at < NOW() - INTERVAL '30 days';
END;
$$;
