-- Fix: policies "founder_reads_*" rompen con 42501 "permission denied for
-- table users" cuando un usuario normal consulta tablas que las tienen.
--
-- Causa: las policies usan EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
-- AND email = 'niko14_gomez@hotmail.com'). Postgres evalúa todas las policies
-- aplicables en OR, así que para CUALQUIER user authenticated que consulte la
-- tabla se intenta ejecutar el SELECT sobre auth.users — y el rol authenticated
-- no tiene SELECT sobre auth.users, lo que dispara 42501.
--
-- Solución: reemplazar el subselect por auth.jwt() ->> 'email', que extrae el
-- email del JWT del usuario directamente sin tocar la tabla. El comportamiento
-- es idéntico (solo el founder pasa la check) pero no requiere permisos sobre
-- auth.users.

-- ─── app_events ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "founder_reads_app_events" ON public.app_events;
CREATE POLICY "founder_reads_app_events" ON public.app_events FOR SELECT
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

-- ─── subscription_charges ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "founder_reads_all_charges" ON public.subscription_charges;
CREATE POLICY "founder_reads_all_charges" ON public.subscription_charges FOR SELECT
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

-- ─── nico_messages ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "founder_reads_nico_messages" ON public.nico_messages;
CREATE POLICY "founder_reads_nico_messages" ON public.nico_messages FOR SELECT
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

-- ─── app_feedback ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "founder_reads_app_feedback" ON public.app_feedback;
CREATE POLICY "founder_reads_app_feedback" ON public.app_feedback FOR SELECT
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

-- ─── nico_lessons ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "founder_reads_nico_lessons_global" ON public.nico_lessons;
CREATE POLICY "founder_reads_nico_lessons_global" ON public.nico_lessons FOR SELECT
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

-- ─── nico_prompt_versions ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "founder_reads_all_versions" ON public.nico_prompt_versions;
CREATE POLICY "founder_reads_all_versions" ON public.nico_prompt_versions FOR SELECT
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

DROP POLICY IF EXISTS "founder_writes_versions" ON public.nico_prompt_versions;
CREATE POLICY "founder_writes_versions" ON public.nico_prompt_versions FOR ALL
  USING (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com')
  WITH CHECK (lower(auth.jwt() ->> 'email') = 'niko14_gomez@hotmail.com');

COMMENT ON POLICY "founder_reads_app_feedback" ON public.app_feedback IS
  'Founder Nico (niko14_gomez@hotmail.com) puede leer todas las respuestas de la encuesta mensual. Otros users solo ven las suyas. Email se lee del JWT (auth.jwt()) en vez de auth.users para evitar permission denied for table users.';
