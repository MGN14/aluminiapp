-- Auto-matching avanzado: pagos bancarios → facturas de venta.
--
-- Objetivo: cuando llega una transaction tipo 'ingreso' sin invoice_id,
-- buscar la factura viva del cliente que probablemente representa.
-- Si confianza alta → vincula automático (setea transactions.invoice_id).
-- Si confianza media → guarda sugerencia para revisión manual.
-- Si baja → skip.
--
-- Señales (suman score 0-100):
--   - Monto exacto vs balance_pending: +50
--   - Monto cercano ±5%: +30  (mutex con exacto)
--   - Número de factura en descripción: +40
--   - Cliente en descripción (nombre o NIT): +25
--   - Fecha cerca de issue_date/due_date (≤30 días): +10
--   - Match con expected_payment del cliente: +35
--
-- Threshold:
--   ≥80 → AUTO (UPDATE transactions.invoice_id)
--   50-79 → SUGGEST (INSERT invoice_match_suggestions con status='pending')
--   <50 → skip

-- =============================================================================
-- 1. Tabla invoice_match_suggestions
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_match_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,

  confidence smallint NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ejemplo signals: {"amount_match":"exact","ref_in_desc":true,"client_match":"name","date_days":7,"expected_payment":true}

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'auto_applied', 'expired')),

  suggested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Evitar sugerencias duplicadas para la misma (tx, invoice) que sigan pendientes
CREATE UNIQUE INDEX IF NOT EXISTS invoice_match_suggestions_unique_pending
  ON public.invoice_match_suggestions(transaction_id, invoice_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS invoice_match_suggestions_user_pending_idx
  ON public.invoice_match_suggestions(user_id, suggested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS invoice_match_suggestions_tx_idx
  ON public.invoice_match_suggestions(transaction_id);

COMMENT ON TABLE public.invoice_match_suggestions IS
  'Sugerencias de matching entre pagos bancarios y facturas con confidence 50-79. UI las muestra para confirmar/rechazar con 1 click.';

ALTER TABLE public.invoice_match_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_sugg_owner_select" ON public.invoice_match_suggestions;
CREATE POLICY "match_sugg_owner_select"
  ON public.invoice_match_suggestions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "match_sugg_owner_update" ON public.invoice_match_suggestions;
CREATE POLICY "match_sugg_owner_update"
  ON public.invoice_match_suggestions FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- INSERT solo vía SECURITY DEFINER del trigger/RPC.

DROP TRIGGER IF EXISTS set_match_sugg_updated_at ON public.invoice_match_suggestions;
CREATE TRIGGER set_match_sugg_updated_at
  BEFORE UPDATE ON public.invoice_match_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 2. Función auxiliar: normalizar nombre de cliente para matching
-- =============================================================================
CREATE OR REPLACE FUNCTION public.normalize_client_name(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      unaccent(lower(COALESCE(s, ''))),
      '\m(sas|s\.a\.s\.?|sa|s\.a\.?|ltda|cia|sociedad|eu|sl|srl)\M', '', 'g'
    ),
    '[^a-z0-9 ]+', ' ', 'g'
  ));
$$;

COMMENT ON FUNCTION public.normalize_client_name(text) IS
  'Normaliza nombre de cliente: quita acentos, tipos sociales (SAS, LTDA, etc.) y caracteres especiales para matching robusto.';

-- =============================================================================
-- 3. Función de scoring: suggest_invoice_matches_for_tx
-- =============================================================================
-- Devuelve tabla (invoice_id, confidence, signals) ordenada por confidence DESC.
-- NO modifica nada. Es read-only.

CREATE OR REPLACE FUNCTION public.suggest_invoice_matches_for_tx(p_tx_id uuid)
RETURNS TABLE (
  invoice_id uuid,
  confidence smallint,
  signals jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx record;
  v_amount numeric;
  v_desc text;
  v_desc_norm text;
  v_amount_min numeric;
  v_amount_max numeric;
BEGIN
  -- Cargar TX
  SELECT t.id, t.user_id, t.date, t.description, t.amount, t.invoice_id, t.type, t.deleted_at
  INTO v_tx
  FROM public.transactions t
  WHERE t.id = p_tx_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_tx.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF v_tx.invoice_id IS NOT NULL THEN RETURN; END IF;
  IF v_tx.type <> 'ingreso' AND COALESCE(v_tx.amount, 0) <= 0 THEN RETURN; END IF;

  v_amount := abs(COALESCE(v_tx.amount, 0));
  v_desc := COALESCE(v_tx.description, '');
  v_desc_norm := unaccent(lower(v_desc));

  -- Rango para "monto cercano" ±10% (más generoso porque muchas veces el cliente paga
  -- el total - retenciones que no conocemos exactamente)
  v_amount_min := v_amount * 0.90;
  v_amount_max := v_amount * 1.10;

  RETURN QUERY
  WITH candidate_invoices AS (
    SELECT
      inv.id,
      inv.invoice_number,
      inv.counterparty_name,
      inv.counterparty_nit,
      inv.issue_date,
      inv.due_date,
      inv.total_amount,
      inv.balance_pending,
      -- Cálculo de señales
      -- 1. Monto match
      CASE
        WHEN inv.balance_pending IS NOT NULL AND abs(inv.balance_pending - v_amount) < 1 THEN 'exact'
        WHEN inv.total_amount IS NOT NULL AND abs(inv.total_amount - v_amount) < 1 THEN 'exact_total'
        WHEN inv.balance_pending IS NOT NULL AND inv.balance_pending BETWEEN v_amount_min AND v_amount_max THEN 'near'
        WHEN inv.total_amount IS NOT NULL AND inv.total_amount BETWEEN v_amount_min AND v_amount_max THEN 'near_total'
        ELSE 'none'
      END AS amount_match,
      -- 2. Número de factura en descripción
      CASE
        WHEN inv.invoice_number IS NOT NULL
          AND inv.invoice_number <> ''
          AND v_desc_norm ~* ('\m' || regexp_replace(lower(inv.invoice_number), '[^a-z0-9]', '', 'g') || '\M')
        THEN true
        WHEN inv.invoice_number IS NOT NULL
          AND inv.invoice_number <> ''
          AND position(lower(inv.invoice_number) IN v_desc_norm) > 0
        THEN true
        ELSE false
      END AS ref_in_desc,
      -- 3. Cliente (nombre) en descripción
      CASE
        WHEN inv.counterparty_name IS NOT NULL AND length(public.normalize_client_name(inv.counterparty_name)) >= 4
          AND position(public.normalize_client_name(inv.counterparty_name) IN public.normalize_client_name(v_desc)) > 0
        THEN 'name'
        WHEN inv.counterparty_nit IS NOT NULL
          AND length(regexp_replace(inv.counterparty_nit, '[^0-9]', '', 'g')) >= 6
          AND position(regexp_replace(inv.counterparty_nit, '[^0-9]', '', 'g') IN regexp_replace(v_desc, '[^0-9]', '', 'g')) > 0
        THEN 'nit'
        ELSE 'none'
      END AS client_match,
      -- 4. Proximidad de fecha (días entre tx.date y issue_date)
      ABS(v_tx.date - inv.issue_date) AS days_from_issue,
      -- 5. Match con expected_payment (subselect)
      (
        SELECT bool_or(
          abs(ep.amount - v_amount) < 1
          AND abs(EXTRACT(EPOCH FROM (ep.due_date::timestamp - v_tx.date::timestamp))/86400) <= 7
        )
        FROM public.expected_payments ep
        WHERE ep.user_id = v_tx.user_id
          AND ep.status = 'pendiente'
          AND ep.invoice_id = inv.id
      ) AS expected_payment_match
    FROM public.invoices inv
    WHERE inv.user_id = v_tx.user_id
      AND inv.type = 'venta'
      AND inv.voided_at IS NULL
      AND inv.balance_pending > 0
      -- Pre-filter: solo facturas con monto vagamente compatible o con número en desc
      AND (
        inv.balance_pending BETWEEN v_amount_min AND v_amount_max
        OR inv.total_amount BETWEEN v_amount_min AND v_amount_max
        OR (inv.invoice_number IS NOT NULL AND inv.invoice_number <> ''
            AND v_desc_norm ~* lower(regexp_replace(inv.invoice_number, '[^a-zA-Z0-9]', '', 'g')))
      )
  ),
  scored AS (
    SELECT
      id,
      -- Score
      (CASE amount_match
        WHEN 'exact' THEN 50
        WHEN 'exact_total' THEN 45
        WHEN 'near' THEN 30
        WHEN 'near_total' THEN 25
        ELSE 0
      END)
      + (CASE WHEN ref_in_desc THEN 40 ELSE 0 END)
      + (CASE client_match
          WHEN 'nit' THEN 30
          WHEN 'name' THEN 25
          ELSE 0
        END)
      + (CASE WHEN days_from_issue <= 30 THEN 10
              WHEN days_from_issue <= 60 THEN 5
              ELSE 0 END)
      + (CASE WHEN expected_payment_match THEN 35 ELSE 0 END)
      AS raw_score,
      jsonb_build_object(
        'amount_match', amount_match,
        'ref_in_desc', ref_in_desc,
        'client_match', client_match,
        'days_from_issue', days_from_issue,
        'expected_payment_match', COALESCE(expected_payment_match, false),
        'invoice_number', invoice_number,
        'counterparty_name', counterparty_name,
        'balance_pending', balance_pending,
        'total_amount', total_amount
      ) AS sig
    FROM candidate_invoices
  )
  SELECT
    scored.id,
    LEAST(100, GREATEST(0, scored.raw_score))::smallint,
    scored.sig
  FROM scored
  WHERE scored.raw_score >= 30 -- piso mínimo para no devolver basura
  ORDER BY scored.raw_score DESC
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_invoice_matches_for_tx(uuid) TO authenticated;

COMMENT ON FUNCTION public.suggest_invoice_matches_for_tx(uuid) IS
  'Devuelve hasta 5 facturas candidatas para una transacción de ingreso con scoring 0-100 y desglose de señales. NO muta.';

-- =============================================================================
-- 4. Función auto_match_bank_payment: aplica/sugiere según threshold
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
  v_second_best record;
  v_top_count int := 0;
BEGIN
  -- Validar que existe y es candidato
  SELECT user_id INTO v_user_id FROM public.transactions
  WHERE id = p_tx_id AND deleted_at IS NULL AND invoice_id IS NULL
    AND (type = 'ingreso' OR amount > 0);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'not_eligible');
  END IF;

  -- Pedir candidatos
  SELECT * INTO v_best
  FROM public.suggest_invoice_matches_for_tx(p_tx_id)
  ORDER BY confidence DESC
  LIMIT 1;

  IF v_best.invoice_id IS NULL THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'no_candidates');
  END IF;

  -- Si hay 2+ candidatos con confidence similar (±5), bajar de auto a suggest
  -- (resolver conflicto: no asumimos cuál es)
  SELECT count(*) INTO v_top_count
  FROM public.suggest_invoice_matches_for_tx(p_tx_id)
  WHERE confidence >= v_best.confidence - 5 AND confidence >= 80;

  -- AUTO (≥80 y único en su top)
  IF v_best.confidence >= 80 AND v_top_count <= 1 THEN
    UPDATE public.transactions
    SET invoice_id = v_best.invoice_id
    WHERE id = p_tx_id;

    INSERT INTO public.invoice_match_suggestions (
      user_id, transaction_id, invoice_id, confidence, signals, status, resolved_at
    ) VALUES (
      v_user_id, p_tx_id, v_best.invoice_id, v_best.confidence, v_best.signals,
      'auto_applied', now()
    );

    RETURN jsonb_build_object(
      'action', 'auto_applied',
      'invoice_id', v_best.invoice_id,
      'confidence', v_best.confidence,
      'signals', v_best.signals
    );
  END IF;

  -- SUGGEST (50-79 o conflicto en el top)
  IF v_best.confidence >= 50 THEN
    INSERT INTO public.invoice_match_suggestions (
      user_id, transaction_id, invoice_id, confidence, signals, status
    ) VALUES (
      v_user_id, p_tx_id, v_best.invoice_id, v_best.confidence, v_best.signals, 'pending'
    )
    ON CONFLICT (transaction_id, invoice_id) WHERE status = 'pending'
    DO UPDATE SET confidence = EXCLUDED.confidence, signals = EXCLUDED.signals, suggested_at = now();

    RETURN jsonb_build_object(
      'action', 'suggested',
      'invoice_id', v_best.invoice_id,
      'confidence', v_best.confidence
    );
  END IF;

  RETURN jsonb_build_object('action', 'skip', 'reason', 'low_confidence', 'best_confidence', v_best.confidence);
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_match_bank_payment(uuid) TO authenticated;

-- =============================================================================
-- 5. Trigger AFTER INSERT en transactions: dispara matching automático
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tg_auto_match_bank_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo intentar si es ingreso sin invoice_id
  IF NEW.invoice_id IS NULL
     AND (NEW.type = 'ingreso' OR COALESCE(NEW.amount, 0) > 0)
     AND NEW.deleted_at IS NULL THEN
    -- Ejecutar fuera del path crítico: si falla, no rompe el INSERT.
    BEGIN
      PERFORM public.auto_match_bank_payment(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'auto_match_bank_payment failed for tx %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_match_bank_after_insert ON public.transactions;
CREATE TRIGGER auto_match_bank_after_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_auto_match_bank_payment();

COMMENT ON TRIGGER auto_match_bank_after_insert ON public.transactions IS
  'Cada TX ingreso nueva (sin invoice_id) se compara contra facturas vivas. Si confidence>=80 auto-vincula, si 50-79 sugiere, si <50 skip.';

-- =============================================================================
-- 6. RPC: run_bank_matching_for_user (batch retroactivo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.run_bank_matching_for_user(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_tx_id uuid;
  v_result jsonb;
  v_processed integer := 0;
  v_auto integer := 0;
  v_suggested integer := 0;
  v_skipped integer := 0;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No user id provided and no auth.uid()';
  END IF;

  FOR v_tx_id IN
    SELECT id FROM public.transactions
    WHERE user_id = v_user
      AND deleted_at IS NULL
      AND invoice_id IS NULL
      AND (type = 'ingreso' OR amount > 0)
    ORDER BY date DESC
    LIMIT p_limit
  LOOP
    v_processed := v_processed + 1;
    BEGIN
      v_result := public.auto_match_bank_payment(v_tx_id);
      CASE v_result->>'action'
        WHEN 'auto_applied' THEN v_auto := v_auto + 1;
        WHEN 'suggested' THEN v_suggested := v_suggested + 1;
        ELSE v_skipped := v_skipped + 1;
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'user_id', v_user,
    'processed', v_processed,
    'auto_applied', v_auto,
    'suggested', v_suggested,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_bank_matching_for_user(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.run_bank_matching_for_user(uuid, integer) IS
  'Batch retroactivo: corre auto_match_bank_payment sobre transactions de ingreso del user sin invoice_id.';
