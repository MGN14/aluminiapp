-- Migration: nico_prompt_versions de admin-only → founder-only para escritura.
--
-- Las versiones del system prompt de Nico IA son decisiones de producto
-- que solo el founder (niko14_gomez@hotmail.com) toma. Cualquier admin
-- regular no debería poder aprobar ni rechazar cambios al prompt.
--
-- PERO: nico-chat (que corre con la sesión del user) necesita LEER la
-- versión aprobada del prompt para usar el system prompt activo. Por eso
-- separamos:
--   - SELECT de versiones APROBADAS: cualquier authenticated (para que
--     Nico funcione para todos los users)
--   - SELECT de TODAS las versiones (pending/rejected/superseded): solo founder
--   - INSERT/UPDATE/DELETE: solo founder

DROP POLICY IF EXISTS "Admins manage prompt versions" ON public.nico_prompt_versions;
DROP POLICY IF EXISTS "founder_manages_prompt_versions" ON public.nico_prompt_versions;

DO $$
BEGIN
  -- 1. Cualquier user autenticado puede leer las versiones APROBADAS
  --    (necesario para que nico-chat use el prompt activo)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_prompt_versions' AND policyname='authenticated_reads_approved_versions') THEN
    CREATE POLICY "authenticated_reads_approved_versions"
      ON public.nico_prompt_versions FOR SELECT
      USING (
        auth.role() = 'authenticated'
        AND status = 'approved'
      );
  END IF;

  -- 2. Founder lee TODAS las versiones (pending/approved/rejected/superseded)
  --    para el panel /nico/evolution
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_prompt_versions' AND policyname='founder_reads_all_versions') THEN
    CREATE POLICY "founder_reads_all_versions"
      ON public.nico_prompt_versions FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = auth.uid()
            AND lower(email) = 'niko14_gomez@hotmail.com'
        )
      );
  END IF;

  -- 3. Founder es el único que puede aprobar/rechazar/insertar
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_prompt_versions' AND policyname='founder_writes_versions') THEN
    CREATE POLICY "founder_writes_versions"
      ON public.nico_prompt_versions FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = auth.uid()
            AND lower(email) = 'niko14_gomez@hotmail.com'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = auth.uid()
            AND lower(email) = 'niko14_gomez@hotmail.com'
        )
      );
  END IF;
END $$;

-- Notas: el edge function nico-prompt-evolution corre con SERVICE_ROLE,
-- así que bypassea RLS al insertar nuevas versiones pending. No necesita
-- policy aparte.

COMMENT ON POLICY "authenticated_reads_approved_versions" ON public.nico_prompt_versions IS
  'Cualquier user autenticado puede leer SOLO versiones approved. Necesario para que nico-chat use el prompt activo en cada conversación.';

COMMENT ON POLICY "founder_reads_all_versions" ON public.nico_prompt_versions IS
  'Founder lee TODAS las versiones (incl. pending) para el panel de aprobación /nico/evolution.';

COMMENT ON POLICY "founder_writes_versions" ON public.nico_prompt_versions IS
  'Solo el founder puede aprobar, rechazar o crear versiones. Edge function evolution usa service role (bypass).';
