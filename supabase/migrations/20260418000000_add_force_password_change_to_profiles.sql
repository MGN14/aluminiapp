-- Prompt 2 — Forzar cambio de contraseña
-- Adds a flag to public.profiles that, when true, requires the user to go
-- through /change-password before accessing the rest of the app.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;

-- Helpful index for the gate query (small table, but future-proof).
CREATE INDEX IF NOT EXISTS idx_profiles_force_password_change
  ON public.profiles (user_id)
  WHERE force_password_change = true;

COMMENT ON COLUMN public.profiles.force_password_change IS
  'When true, the user must change their password via /change-password before using the app.';
