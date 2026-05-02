-- Migration: founder reads global para Analytics dashboard.
--
-- Para que /admin/analytics pueda mostrar agregados de TODOS los usuarios
-- (DAU, MAU, top features, encuesta promedio, feedback Nico, etc.),
-- el founder necesita SELECT sobre las tablas relevantes — no solo sobre
-- sus propios rows.
--
-- Convención: igual que app_events ("founder_reads_app_events"), las
-- policies hardcodean el email del founder. Si el equipo crece, mover
-- a tabla `founder_users` con role='founder'.
--
-- IMPORTANTE: las policies se SUMAN a las existentes (RLS evalúa OR
-- entre policies). Los users normales siguen sin acceso a data ajena.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_messages' AND policyname='founder_reads_nico_messages') THEN
    CREATE POLICY "founder_reads_nico_messages"
      ON public.nico_messages FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = auth.uid()
            AND lower(email) = 'niko14_gomez@hotmail.com'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_feedback' AND policyname='founder_reads_app_feedback') THEN
    CREATE POLICY "founder_reads_app_feedback"
      ON public.app_feedback FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = auth.uid()
            AND lower(email) = 'niko14_gomez@hotmail.com'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_lessons' AND policyname='founder_reads_nico_lessons_global') THEN
    -- Las lecciones ya son lectura colectiva pero solo de authenticated.
    -- Founder mantiene esa lectura (esta policy es redundante pero explicit).
    CREATE POLICY "founder_reads_nico_lessons_global"
      ON public.nico_lessons FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE id = auth.uid()
            AND lower(email) = 'niko14_gomez@hotmail.com'
        )
      );
  END IF;
END $$;

COMMENT ON POLICY "founder_reads_nico_messages" ON public.nico_messages IS
  'El founder Nico (niko14_gomez@hotmail.com) puede leer todos los mensajes para el dashboard /admin/analytics. Otros users siguen viendo solo los suyos.';

COMMENT ON POLICY "founder_reads_app_feedback" ON public.app_feedback IS
  'El founder Nico puede leer todas las respuestas de la encuesta mensual para análisis. Otros users solo ven las suyas.';
