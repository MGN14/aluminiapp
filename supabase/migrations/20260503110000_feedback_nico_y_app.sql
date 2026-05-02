-- Migration: feedback de respuestas de Nico IA + encuesta mensual de la app.
--
-- Parte 1: agrega 3 columnas a nico_messages para que el usuario pueda
--          calificar cada respuesta del asistente (👍/👎 + texto opcional).
-- Parte 2: nueva tabla app_feedback para la encuesta mensual general
--          (1-5 estrellas + wishlist + comentarios libres).

-- ============================================================================
-- Parte 1 — feedback en nico_messages
-- ============================================================================

ALTER TABLE public.nico_messages
  ADD COLUMN IF NOT EXISTS feedback smallint
    CHECK (feedback IS NULL OR feedback IN (-1, 0, 1)),
  ADD COLUMN IF NOT EXISTS feedback_text text,
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;

COMMENT ON COLUMN public.nico_messages.feedback IS
  'Calificación del usuario sobre la respuesta del asistente: -1 (mala), 0 (neutral), 1 (buena). NULL = sin calificar. Solo aplica a mensajes con role=assistant.';

COMMENT ON COLUMN public.nico_messages.feedback_text IS
  'Texto libre que el usuario escribe cuando da feedback negativo (qué estuvo mal). Opcional.';

COMMENT ON COLUMN public.nico_messages.feedback_at IS
  'Timestamp de cuándo se dio el feedback. NULL si nunca se calificó.';

-- Policy de UPDATE: solo el dueño puede actualizar sus propios mensajes
-- (para escribir el feedback). Las otras policies (SELECT/INSERT/DELETE) ya existen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'nico_messages'
      AND policyname = 'Users can update their own messages'
  ) THEN
    CREATE POLICY "Users can update their own messages"
      ON public.nico_messages
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nico_messages_negative_feedback
  ON public.nico_messages(user_id, feedback_at DESC)
  WHERE feedback = -1;

-- ============================================================================
-- Parte 2 — app_feedback (encuesta mensual general)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  wishlist text,
  comments text,
  app_version text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_feedback IS
  'Encuesta mensual de calificación general de la app (1-5 estrellas + wishlist + comentarios libres). Pop-up que aparece cada 30 días desde la última respuesta a usuarios con >7 días de uso.';

CREATE INDEX IF NOT EXISTS idx_app_feedback_user_submitted
  ON public.app_feedback(user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_feedback_submitted
  ON public.app_feedback(submitted_at DESC);

ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_feedback' AND policyname='Users can view their own feedback') THEN
    CREATE POLICY "Users can view their own feedback"
      ON public.app_feedback FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_feedback' AND policyname='Users can insert their own feedback') THEN
    CREATE POLICY "Users can insert their own feedback"
      ON public.app_feedback FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- Parte 3 — tabla auxiliar para postpone "más tarde" del modal
-- ============================================================================
-- Cuando el user clickea "Más tarde" guardamos un timestamp para no
-- mostrarle el modal de nuevo en 7 días, sin necesidad de meter
-- un null/sentinela en app_feedback (que es solo para respuestas reales).

CREATE TABLE IF NOT EXISTS public.app_feedback_postponed (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  postponed_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_feedback_postponed IS
  'Si el usuario clickea "Más tarde" en el pop-up de feedback, guardamos hasta cuándo no mostrarlo.';

ALTER TABLE public.app_feedback_postponed ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_feedback_postponed' AND policyname='Users can manage own postpone') THEN
    CREATE POLICY "Users can manage own postpone"
      ON public.app_feedback_postponed FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
