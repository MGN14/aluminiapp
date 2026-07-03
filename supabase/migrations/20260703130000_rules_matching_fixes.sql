-- Fixes al motor de reglas de conciliación (apply_reconciliation_rules_to_tx):
--
-- 1. BUG: la migración 20260630160000 agregó reconciliation_rules.movement_nature
--    pero nunca actualizó esta función — el trigger AFTER INSERT y el RPC
--    retroactivo aplicaban category_id/responsible_id pero IGNORABAN
--    movement_nature. La regla "PAGO TARJETA → traspaso" solo funcionaba por
--    el camino TS del uploader (applyRulesToStatement), no por trigger ni RPC.
--
-- 2. Matching más robusto: colapsar espacios internos en descripción y keyword
--    (regexp_replace '\s+' → ' '). El extracto trae dobles espacios
--    ("COMPRA INTL  Spotify", "PAGO PSE DIAN   PSE") y las keywords de los
--    usuarios varían el espaciado. Espejo exacto de normalizeForMatch en TS
--    (src/lib/stringUtils.ts).
--
-- Mismo signature y return type → CREATE OR REPLACE es seguro.

CREATE EXTENSION IF NOT EXISTS unaccent;

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
  -- Normalización espejo de normalizeForMatch (TS): lower + trim + unaccent
  -- + colapso de espacios internos.
  v_norm_desc := regexp_replace(
    unaccent(lower(trim(COALESCE(v_tx.description, '')))),
    '\s+', ' ', 'g'
  );

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
        IF position(
          regexp_replace(unaccent(lower(trim(v_rule.keyword))), '\s+', ' ', 'g')
          IN v_norm_desc
        ) = 0 THEN
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- MATCH: aplicar regla (solo rellena campos vacíos, nunca pisa lo manual)
    UPDATE public.transactions
    SET
      category_id = COALESCE(category_id, v_rule.category_id),
      responsible_id = COALESCE(responsible_id, v_rule.responsible_id),
      movement_nature = COALESCE(movement_nature, v_rule.movement_nature)
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
  'Aplica la primera regla de conciliación que coincida con la transacción dada (orden: especificidad DESC, creación ASC). Setea category_id, responsible_id y movement_nature solo si están vacíos. Devuelve el rule_id usado o NULL si ninguna matchea.';
