-- Libro de aciertos — cada predicción de la app, confrontada con la realidad.
--
-- La app predice (gastos recurrentes, score de cobranza) y hasta hoy nunca se
-- enteraba de si acertó. Este log registra la predicción al emitirla y un
-- resolver diario (update-business-memory, mismo cron) la cierra contra los
-- datos reales cuando vence la ventana. El % de acierto visible convierte
-- "una opinión de la IA" en un track record auditable.
--
-- Escrituras: SOLO las edge functions (service role). El usuario lee su
-- historial (RLS select) — el libro no se edita a mano.

CREATE TABLE IF NOT EXISTS public.prediction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('gasto_recurrente', 'score_cobranza')),
  -- gasto_recurrente → pattern_key · score_cobranza → client_id canónico
  subject_key text NOT NULL,
  subject_label text NOT NULL DEFAULT '',
  -- gasto: {estimated_amount, estimated_date, confidence, source}
  -- score:  {score, deuda_viva}
  predicted jsonb NOT NULL,
  predicted_at timestamptz NOT NULL DEFAULT now(),
  -- Desde cuándo se puede resolver (fin de la ventana de observación).
  resolve_after date NOT NULL,
  -- Lo que pasó de verdad: gasto → {found_amount, found_date} · score → {pagos_ventana}
  actual jsonb,
  -- true/false = acierto/fallo · NULL con resolved_at = zona gris (score 40-59:
  -- el modelo no se comprometió, no se cuenta en el %).
  hit boolean,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un solo log ABIERTO por sujeto: el cron corre a diario y no debe duplicar
-- la misma predicción pendiente cada mañana.
CREATE UNIQUE INDEX IF NOT EXISTS prediction_log_open_uidx
  ON public.prediction_log(user_id, kind, subject_key)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prediction_log_user_kind
  ON public.prediction_log(user_id, kind, resolved_at);

ALTER TABLE public.prediction_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own prediction log" ON public.prediction_log;
CREATE POLICY "Users view own prediction log"
  ON public.prediction_log FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());

NOTIFY pgrst, 'reload schema';
