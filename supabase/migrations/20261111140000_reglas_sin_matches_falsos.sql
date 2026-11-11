-- ============================================================================
-- Reglas de conciliación: no contar como "match" lo que no cambia nada
-- ============================================================================
-- Reporte de Nico (2026-11-11): el aviso "19 de 53 transacciones categorizadas
-- automáticamente" salía cada vez que entraba a Conciliación.
--
-- Causa: una regla que solo trae categoría (ej. "consignacion corresponsal cb"
-- → Ventas, sin beneficiario) deja la fila con responsible_id NULL. El barrido
-- (apply_pending_rules_for_user) vuelve a tomar toda fila con categoría O
-- beneficiario vacío, la regla vuelve a coincidir y esta función:
--   · hacía un UPDATE que no cambiaba nada (COALESCE),
--   · sumaba +1 a match_count,
--   · insertaba otra fila en transaction_match_log,
--   · y devolvía la regla → contaba como "categorizada".
-- En producción: 2.182 filas en el log para 158 pares reales (tx, regla); las
-- dos reglas de consignaciones marcaban 1.422 y 666 matches sobre 19 filas.
-- Los datos nunca se perdieron (la categoría quedó guardada desde la primera
-- vez): lo falso era el conteo y el aviso.
--
-- Arreglo: la primera regla que coincide sigue ganando (misma selección que
-- antes), pero si no APORTA ningún campo vacío no se escribe nada, no se suma
-- el contador, no se registra en el log y la función devuelve NULL.
-- Misma firma y mismo tipo de retorno: CREATE OR REPLACE alcanza.

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
  SELECT id, user_id, date, description, amount, category_id, responsible_id, movement_nature, deleted_at
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

    -- COINCIDE. ¿Aporta algo? Solo cuenta si llena al menos un campo vacío.
    -- Si no aporta, la primera regla que coincide igual "gana" (no se pasa a
    -- una menos específica: mezclaría la categoría de una regla con el
    -- beneficiario de otra), pero no hay nada que escribir ni que contar.
    IF NOT (
         (v_tx.category_id     IS NULL AND v_rule.category_id     IS NOT NULL)
      OR (v_tx.responsible_id  IS NULL AND v_rule.responsible_id  IS NOT NULL)
      OR (v_tx.movement_nature IS NULL AND v_rule.movement_nature IS NOT NULL)
    ) THEN
      EXIT;
    END IF;

    -- Aplicar regla (solo rellena campos vacíos, nunca pisa lo manual)
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
  'Aplica la primera regla de conciliación que coincida con la transacción (orden: especificidad DESC, creación ASC). Solo rellena campos vacíos. Devuelve el rule_id SOLO si la regla llenó algo; si coincide pero no aporta ningún campo vacío no escribe, no suma match_count, no registra en el log y devuelve NULL.';
