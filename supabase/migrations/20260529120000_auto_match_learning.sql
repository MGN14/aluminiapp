-- Aprendizaje pasivo del auto-matching banco→factura.
--
-- El sistema observa cómo el user confirma/rechaza sugerencias y ajusta el
-- scoring futuro: si una señal predice bien (alto % de confirmados), suma
-- bonus al score; si predice mal (alto % de rechazados), aplica penalty.
--
-- Implementación:
-- 1. View user_match_learning_stats con métricas por señal (% confirm rate).
-- 2. Función get_user_learning_adjustment(user_id, signals) → int (delta a aplicar al score).
-- 3. Modificación de auto_match_bank_payment para aplicar ese delta antes del threshold.
--
-- Decisiones:
-- - Mínimo 20 decisiones totales para activar learning (under-trained user = 0 delta).
-- - Por señal: mínimo 5 muestras para considerar la métrica fiable.
-- - Cap absoluto del delta total: ±25 puntos para no descontrolar.

-- =============================================================================
-- 1. View: stats por señal por user
-- =============================================================================
CREATE OR REPLACE VIEW public.user_match_learning_stats AS
WITH base AS (
  SELECT
    user_id,
    status,
    signals
  FROM public.invoice_match_suggestions
  WHERE status IN ('confirmed', 'rejected')
),
totals AS (
  SELECT
    user_id,
    count(*) FILTER (WHERE status = 'confirmed') AS confirmed_total,
    count(*) FILTER (WHERE status = 'rejected') AS rejected_total,
    count(*) AS decisions_total
  FROM base
  GROUP BY user_id
),
signal_stats AS (
  -- ref_in_desc=true
  SELECT
    user_id,
    'ref_in_desc' AS signal,
    'true' AS value,
    count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
    count(*) FILTER (WHERE status = 'rejected') AS rejected,
    count(*) AS total
  FROM base
  WHERE (signals->>'ref_in_desc')::boolean = true
  GROUP BY user_id
  UNION ALL
  -- client_match values
  SELECT user_id, 'client_match', signals->>'client_match',
    count(*) FILTER (WHERE status='confirmed'), count(*) FILTER (WHERE status='rejected'), count(*)
  FROM base
  WHERE signals->>'client_match' IN ('nit', 'name')
  GROUP BY user_id, signals->>'client_match'
  UNION ALL
  -- amount_match values
  SELECT user_id, 'amount_match', signals->>'amount_match',
    count(*) FILTER (WHERE status='confirmed'), count(*) FILTER (WHERE status='rejected'), count(*)
  FROM base
  WHERE signals->>'amount_match' IN ('exact', 'exact_total', 'near', 'near_total')
  GROUP BY user_id, signals->>'amount_match'
  UNION ALL
  -- expected_payment_match=true
  SELECT user_id, 'expected_payment_match', 'true',
    count(*) FILTER (WHERE status='confirmed'), count(*) FILTER (WHERE status='rejected'), count(*)
  FROM base
  WHERE (signals->>'expected_payment_match')::boolean = true
  GROUP BY user_id
)
SELECT
  s.user_id,
  s.signal,
  s.value,
  s.confirmed,
  s.rejected,
  s.total,
  ROUND(100.0 * s.confirmed / NULLIF(s.total, 0), 1) AS confirm_pct,
  t.decisions_total AS user_decisions_total
FROM signal_stats s
JOIN totals t ON s.user_id = t.user_id;

ALTER VIEW public.user_match_learning_stats SET (security_invoker = true);

COMMENT ON VIEW public.user_match_learning_stats IS
  '% de confirmación por señal por user. Base del aprendizaje pasivo: señales con alta confirm_pct → bonus al score; baja → penalty.';

-- =============================================================================
-- 2. Función: get_user_learning_adjustment(user_id, signals)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_user_learning_adjustment(
  p_user_id uuid,
  p_signals jsonb
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decisions_total int;
  v_adjustment int := 0;
  v_stat record;
BEGIN
  -- Total de decisiones del user. Sin >=20 decisiones, no ajustar.
  SELECT count(*)
  INTO v_decisions_total
  FROM public.invoice_match_suggestions
  WHERE user_id = p_user_id
    AND status IN ('confirmed', 'rejected');

  IF v_decisions_total < 20 THEN RETURN 0; END IF;

  -- Ajuste por señal: requiere >=5 muestras de esa señal para considerar.
  -- ref_in_desc=true
  IF (p_signals->>'ref_in_desc')::boolean IS TRUE THEN
    SELECT * INTO v_stat FROM public.user_match_learning_stats
    WHERE user_id = p_user_id AND signal = 'ref_in_desc' AND value = 'true';
    IF v_stat.total IS NOT NULL AND v_stat.total >= 5 THEN
      IF v_stat.confirm_pct >= 90 THEN v_adjustment := v_adjustment + 10;
      ELSIF v_stat.confirm_pct >= 70 THEN v_adjustment := v_adjustment + 5;
      ELSIF v_stat.confirm_pct <= 30 THEN v_adjustment := v_adjustment - 10;
      ELSIF v_stat.confirm_pct <= 50 THEN v_adjustment := v_adjustment - 5;
      END IF;
    END IF;
  END IF;

  -- client_match
  IF p_signals->>'client_match' IN ('nit', 'name') THEN
    SELECT * INTO v_stat FROM public.user_match_learning_stats
    WHERE user_id = p_user_id AND signal = 'client_match' AND value = p_signals->>'client_match';
    IF v_stat.total IS NOT NULL AND v_stat.total >= 5 THEN
      IF v_stat.confirm_pct >= 85 THEN v_adjustment := v_adjustment + 7;
      ELSIF v_stat.confirm_pct >= 65 THEN v_adjustment := v_adjustment + 3;
      ELSIF v_stat.confirm_pct <= 35 THEN v_adjustment := v_adjustment - 7;
      ELSIF v_stat.confirm_pct <= 50 THEN v_adjustment := v_adjustment - 3;
      END IF;
    END IF;
  END IF;

  -- amount_match
  IF p_signals->>'amount_match' IN ('exact', 'exact_total', 'near', 'near_total') THEN
    SELECT * INTO v_stat FROM public.user_match_learning_stats
    WHERE user_id = p_user_id AND signal = 'amount_match' AND value = p_signals->>'amount_match';
    IF v_stat.total IS NOT NULL AND v_stat.total >= 5 THEN
      IF v_stat.confirm_pct >= 85 THEN v_adjustment := v_adjustment + 5;
      ELSIF v_stat.confirm_pct <= 30 THEN v_adjustment := v_adjustment - 8;
      END IF;
    END IF;
  END IF;

  -- expected_payment_match=true
  IF (p_signals->>'expected_payment_match')::boolean IS TRUE THEN
    SELECT * INTO v_stat FROM public.user_match_learning_stats
    WHERE user_id = p_user_id AND signal = 'expected_payment_match' AND value = 'true';
    IF v_stat.total IS NOT NULL AND v_stat.total >= 5 THEN
      IF v_stat.confirm_pct >= 90 THEN v_adjustment := v_adjustment + 8;
      ELSIF v_stat.confirm_pct <= 40 THEN v_adjustment := v_adjustment - 5;
      END IF;
    END IF;
  END IF;

  -- Clamp absoluto: ±25 pts max
  IF v_adjustment > 25 THEN v_adjustment := 25; END IF;
  IF v_adjustment < -25 THEN v_adjustment := -25; END IF;

  RETURN v_adjustment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_learning_adjustment(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_user_learning_adjustment(uuid, jsonb) IS
  'Aprendizaje pasivo: devuelve delta (±25 max) basado en histórico de confirms/rejects del user. 0 si <20 decisiones.';

-- =============================================================================
-- 3. Reescribir auto_match_bank_payment para usar el learning
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auto_match_bank_payment(p_tx_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_best record;
  v_top_count int := 0;
  v_learning_delta int := 0;
  v_adjusted_score int;
BEGIN
  -- Validar que existe y es candidato
  SELECT user_id INTO v_user_id FROM public.transactions
  WHERE id = p_tx_id AND deleted_at IS NULL AND invoice_id IS NULL
    AND (type = 'ingreso' OR amount > 0);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'not_eligible');
  END IF;

  -- Mejor candidato según scoring base
  SELECT * INTO v_best
  FROM public.suggest_invoice_matches_for_tx(p_tx_id)
  ORDER BY confidence DESC
  LIMIT 1;

  IF v_best.invoice_id IS NULL THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'no_candidates');
  END IF;

  -- ¿Cuántos top candidates dentro de ±5 pts del mejor?
  SELECT count(*) INTO v_top_count
  FROM public.suggest_invoice_matches_for_tx(p_tx_id)
  WHERE confidence >= v_best.confidence - 5 AND confidence >= 80;

  -- APRENDIZAJE PASIVO: ajustar score según histórico del user
  v_learning_delta := public.get_user_learning_adjustment(v_user_id, v_best.signals);
  v_adjusted_score := LEAST(100, GREATEST(0, v_best.confidence + v_learning_delta));

  -- AUTO (score ajustado >=80 y único en su top)
  IF v_adjusted_score >= 80 AND v_top_count <= 1 THEN
    UPDATE public.transactions
    SET invoice_id = v_best.invoice_id
    WHERE id = p_tx_id;

    INSERT INTO public.invoice_match_suggestions (
      user_id, transaction_id, invoice_id, confidence, signals, status, resolved_at
    ) VALUES (
      v_user_id, p_tx_id, v_best.invoice_id, v_adjusted_score,
      v_best.signals || jsonb_build_object('learning_delta', v_learning_delta, 'base_score', v_best.confidence),
      'auto_applied', now()
    );

    RETURN jsonb_build_object(
      'action', 'auto_applied',
      'invoice_id', v_best.invoice_id,
      'confidence', v_adjusted_score,
      'base_score', v_best.confidence,
      'learning_delta', v_learning_delta,
      'signals', v_best.signals
    );
  END IF;

  -- SUGGEST (ajustado 50-79 o conflicto)
  IF v_adjusted_score >= 50 THEN
    INSERT INTO public.invoice_match_suggestions (
      user_id, transaction_id, invoice_id, confidence, signals, status
    ) VALUES (
      v_user_id, p_tx_id, v_best.invoice_id, v_adjusted_score,
      v_best.signals || jsonb_build_object('learning_delta', v_learning_delta, 'base_score', v_best.confidence),
      'pending'
    )
    ON CONFLICT (transaction_id, invoice_id) WHERE status = 'pending'
    DO UPDATE SET confidence = EXCLUDED.confidence, signals = EXCLUDED.signals, suggested_at = now();

    RETURN jsonb_build_object(
      'action', 'suggested',
      'invoice_id', v_best.invoice_id,
      'confidence', v_adjusted_score,
      'base_score', v_best.confidence,
      'learning_delta', v_learning_delta
    );
  END IF;

  RETURN jsonb_build_object(
    'action', 'skip',
    'reason', 'low_confidence',
    'best_confidence', v_adjusted_score,
    'base_score', v_best.confidence,
    'learning_delta', v_learning_delta
  );
END;
$$;
