-- Auto-matching v2: trigger DB + audit log + regex + especificidad
--
-- Problemas del sistema actual:
--   1. La lógica matchesRule() vive en TS → solo se ejecuta cuando WeeklyCsvUploader
--      llama applyRulesToStatement(). Si una TX se inserta por otra vía (RPC,
--      otra edge function, import manual), las reglas NO se aplican.
--   2. Si el user crea una regla DESPUÉS de tener TX viejas, no se aplican
--      retroactivamente excepto si toca el botón "Aplicar a todas".
--   3. Sin audit trail → no se sabe qué regla matcheó qué TX.
--   4. Sin regex → reglas potentes tipo /PAGO.*ALUMINIOS/i imposibles.
--   5. Sin resolución de conflicto entre 2+ reglas que matchean la misma TX.
--
-- Solución:
--   1. Función PL/pgSQL apply_reconciliation_rules_to_tx(tx_id) que aplica
--      reglas activas con orden por especificidad descendente.
--   2. Trigger AFTER INSERT en transactions que la llama (todo INSERT pasa por reglas).
--   3. Tabla transaction_match_log para audit (qué regla, cuándo, cómo).
--   4. Columna keyword_is_regex en reconciliation_rules para activar regex match.
--   5. Función auxiliar apply_pending_rules_for_user(user_id) para batch retroactivo.

-- Habilitar extensión unaccent (igual que normalizeForMatch en TS)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- =============================================================================
-- 1. Columna nueva: keyword_is_regex
-- =============================================================================
ALTER TABLE public.reconciliation_rules
  ADD COLUMN IF NOT EXISTS keyword_is_regex boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reconciliation_rules.keyword_is_regex IS
  'Si true, keyword se trata como regex POSIX case-insensitive. Si false, includes (substring).';

-- =============================================================================
-- 2. Tabla transaction_match_log (audit de matches)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.transaction_match_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.reconciliation_rules(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('trigger', 'manual', 'retro_cron', 'frontend')),
  matched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_match_log_user_tx_idx
  ON public.transaction_match_log(user_id, transaction_id);
CREATE INDEX IF NOT EXISTS transaction_match_log_rule_idx
  ON public.transaction_match_log(rule_id, matched_at DESC);

COMMENT ON TABLE public.transaction_match_log IS
  'Audit de qué regla matcheó cada transacción. source distingue trigger automático vs aplicación manual/cron retroactivo.';

ALTER TABLE public.transaction_match_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_log_owner_select" ON public.transaction_match_log;
CREATE POLICY "match_log_owner_select"
  ON public.transaction_match_log FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT solo vía SECURITY DEFINER functions (trigger / RPC), no directo.

-- =============================================================================
-- 3. Función de especificidad: rankea reglas para resolución de conflicto
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reconciliation_rule_specificity(rule_row public.reconciliation_rules)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  score integer := 0;
BEGIN
  IF rule_row.keyword IS NOT NULL AND rule_row.keyword <> '' THEN score := score + 10; END IF;
  IF rule_row.amount_min IS NOT NULL THEN score := score + 3; END IF;
  IF rule_row.amount_max IS NOT NULL THEN score := score + 3; END IF;
  IF rule_row.day_min IS NOT NULL THEN score := score + 2; END IF;
  IF rule_row.day_max IS NOT NULL THEN score := score + 2; END IF;
  IF rule_row.responsible_id IS NOT NULL THEN score := score + 5; END IF;
  IF rule_row.category_id IS NOT NULL THEN score := score + 5; END IF;
  RETURN score;
END;
$$;

-- =============================================================================
-- 4. Función principal: apply_reconciliation_rules_to_tx
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_reconciliation_rules_to_tx(
  p_tx_id uuid,
  p_source text DEFAULT 'trigger'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx record;
  v_rule record;
  v_norm_desc text;
  v_tx_type text;
  v_amount numeric;
  v_day integer;
  v_matched_rule_id uuid := NULL;
  v_user_id uuid;
BEGIN
  -- Cargar TX
  SELECT id, user_id, date, description, amount, category_id, responsible_id, deleted_at
  INTO v_tx
  FROM public.transactions
  WHERE id = p_tx_id;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_tx.deleted_at IS NOT NULL THEN RETURN NULL; END IF;

  -- Skip si ya está totalmente categorizada
  IF v_tx.category_id IS NOT NULL AND v_tx.responsible_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  v_user_id := v_tx.user_id;
  v_amount := abs(COALESCE(v_tx.amount, 0));
  v_tx_type := CASE WHEN COALESCE(v_tx.amount, 0) < 0 THEN 'egreso' ELSE 'ingreso' END;
  v_day := EXTRACT(DAY FROM v_tx.date)::integer;
  v_norm_desc := unaccent(lower(trim(COALESCE(v_tx.description, ''))));

  -- Iterar reglas activas del user, más específicas primero, dentro de eso
  -- las más viejas primero (estable). LIMIT 1 implícito porque RETURN al primer match.
  FOR v_rule IN
    SELECT *
    FROM public.reconciliation_rules
    WHERE user_id = v_user_id
      AND active = true
      AND tx_type = v_tx_type
    ORDER BY public.reconciliation_rule_specificity(reconciliation_rules.*) DESC, created_at ASC
  LOOP
    -- Filtros numéricos
    IF v_rule.amount_min IS NOT NULL AND v_amount < v_rule.amount_min THEN CONTINUE; END IF;
    IF v_rule.amount_max IS NOT NULL AND v_amount > v_rule.amount_max THEN CONTINUE; END IF;
    IF v_rule.day_min IS NOT NULL AND v_day < v_rule.day_min THEN CONTINUE; END IF;
    IF v_rule.day_max IS NOT NULL AND v_day > v_rule.day_max THEN CONTINUE; END IF;

    -- Filtro keyword
    IF v_rule.keyword IS NOT NULL AND v_rule.keyword <> '' THEN
      IF v_rule.keyword_is_regex THEN
        -- Regex POSIX case-insensitive
        IF NOT (v_norm_desc ~* v_rule.keyword) THEN CONTINUE; END IF;
      ELSE
        -- Substring (normalizado igual que el TS matchesRule)
        IF position(unaccent(lower(trim(v_rule.keyword))) IN v_norm_desc) = 0 THEN
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- MATCH: aplicar regla
    UPDATE public.transactions
    SET
      category_id = COALESCE(category_id, v_rule.category_id),
      responsible_id = COALESCE(responsible_id, v_rule.responsible_id)
    WHERE id = p_tx_id;

    -- Bump match_count
    UPDATE public.reconciliation_rules
    SET match_count = match_count + 1,
        last_matched_at = now(),
        updated_at = now()
    WHERE id = v_rule.id;

    -- Audit log
    INSERT INTO public.transaction_match_log (user_id, transaction_id, rule_id, source)
    VALUES (v_user_id, p_tx_id, v_rule.id, p_source);

    v_matched_rule_id := v_rule.id;
    EXIT; -- primera regla que matchea gana
  END LOOP;

  RETURN v_matched_rule_id;
END;
$$;

COMMENT ON FUNCTION public.apply_reconciliation_rules_to_tx(uuid, text) IS
  'Aplica la primera regla de conciliación que coincida con la transacción dada (orden: especificidad DESC, creación ASC). Devuelve el rule_id usado o NULL si ninguna matchea.';

GRANT EXECUTE ON FUNCTION public.apply_reconciliation_rules_to_tx(uuid, text) TO authenticated, anon;

-- =============================================================================
-- 5. Trigger AFTER INSERT en transactions
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tg_apply_rules_on_tx_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo intentar si la TX no viene pre-categorizada
  IF NEW.category_id IS NULL OR NEW.responsible_id IS NULL THEN
    PERFORM public.apply_reconciliation_rules_to_tx(NEW.id, 'trigger');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_rules_after_insert ON public.transactions;
CREATE TRIGGER apply_rules_after_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_apply_rules_on_tx_insert();

COMMENT ON TRIGGER apply_rules_after_insert ON public.transactions IS
  'Auto-aplica reglas de conciliación a cada TX nueva. Si la TX viene con category_id+responsible_id ya seteados, no hace nada.';

-- =============================================================================
-- 6. RPC: apply_pending_rules_for_user (batch retroactivo manual + cron)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_pending_rules_for_user(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_source text DEFAULT 'retro_cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_tx_id uuid;
  v_rule_id uuid;
  v_processed integer := 0;
  v_matched integer := 0;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No user id provided and no auth.uid()';
  END IF;

  FOR v_tx_id IN
    SELECT id FROM public.transactions
    WHERE user_id = v_user
      AND deleted_at IS NULL
      AND (category_id IS NULL OR responsible_id IS NULL)
    ORDER BY date DESC
    LIMIT p_limit
  LOOP
    v_processed := v_processed + 1;
    v_rule_id := public.apply_reconciliation_rules_to_tx(v_tx_id, p_source);
    IF v_rule_id IS NOT NULL THEN v_matched := v_matched + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'user_id', v_user,
    'processed', v_processed,
    'matched', v_matched,
    'source', p_source
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_pending_rules_for_user(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.apply_pending_rules_for_user(uuid, integer, text) IS
  'Aplica reglas retroactivamente a TX del user sin matchear. Útil para batch manual + cron de seguridad.';
