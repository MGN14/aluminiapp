-- Telemetría interna AluminIA: log unificado de eventos de uso de la app.
-- Lo lee SOLO el founder (Nicolás), nunca usuarios. Se usa para:
--   - Avisos inmediatos (signup, payment_failed, subscription_canceled)
--   - Reporte semanal (DAU, uso de Nico IA, errores, etc.)
--   - Página /admin con KPIs

CREATE TABLE IF NOT EXISTS public.app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_events_type_time
  ON public.app_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_events_user_time
  ON public.app_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_events_time
  ON public.app_events (occurred_at DESC);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

-- Founder hardcoded por email (Nico). Si el equipo crece, mover a tabla
-- founder_users con role='admin' y reemplazar este policy.
CREATE POLICY "founder_reads_app_events"
  ON public.app_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND lower(email) = 'niko14_gomez@hotmail.com'
    )
  );

-- Usuarios autenticados pueden registrar eventos a su propio nombre.
-- Edge functions usan service role y bypassean RLS, así que pueden insertar
-- eventos para cualquier user_id (incluido NULL para signup pre-profile).
CREATE POLICY "users_insert_own_events"
  ON public.app_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  );

COMMENT ON TABLE public.app_events IS
  'Telemetría interna AluminIA. Sólo founder lee. Usuarios pueden insertar sus propios eventos vía cliente; edge functions insertan via service role.';
