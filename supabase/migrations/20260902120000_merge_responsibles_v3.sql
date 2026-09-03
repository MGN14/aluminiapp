-- ============================================================================
-- merge_responsibles v3 — la v2 referenciaba income_receipts, tabla que fue
-- BORRADA por 20260525150000 (comprobante de ingreso pasó a Caja Menor, 0
-- filas): plpgsql reventaba al llegar a ese UPDATE y TODA la unión se
-- revertía con "relation public.income_receipts does not exist"
-- (reporte Nico 2026-09-02).
--
-- v3: income_receipts fuera (muerta), y toda tabla NO-núcleo se toca solo si
-- existe en esta base (to_regclass + EXECUTE) — una tabla ausente o borrada
-- a futuro nunca más tumba la unión. El núcleo (invoices, transactions,
-- cash, petty_cash, remisiones, reglas, credits) queda estático.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.merge_responsibles(
  p_legacy_id uuid,
  p_canonical_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_legacy_name text;
  v_legacy_user_id uuid;
  v_canonical_user_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_legacy_id = p_canonical_id THEN
    RAISE EXCEPTION 'No podés vincular un beneficiario consigo mismo';
  END IF;

  SELECT user_id, name INTO v_legacy_user_id, v_legacy_name
    FROM public.responsibles WHERE id = p_legacy_id;
  SELECT user_id INTO v_canonical_user_id
    FROM public.responsibles WHERE id = p_canonical_id;

  IF v_legacy_user_id IS NULL THEN
    RAISE EXCEPTION 'Beneficiario legacy no encontrado';
  END IF;
  IF v_canonical_user_id IS NULL THEN
    RAISE EXCEPTION 'Beneficiario canonical no encontrado';
  END IF;
  IF v_legacy_user_id <> v_user_id OR v_canonical_user_id <> v_user_id THEN
    RAISE EXCEPTION 'No tenés permisos sobre estos beneficiarios';
  END IF;

  -- Núcleo (siempre existe)
  UPDATE public.invoices              SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.transactions          SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.transactions          SET operative_responsible_id = p_canonical_id WHERE operative_responsible_id = p_legacy_id;
  UPDATE public.cash_movements        SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.petty_cash_movements  SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.remisiones            SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.reconciliation_rules  SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.credits               SET default_responsible_id   = p_canonical_id WHERE default_responsible_id   = p_legacy_id;

  -- Módulos: solo si la tabla existe en esta base.
  IF to_regclass('public.operative_receivables') IS NOT NULL THEN
    EXECUTE 'UPDATE public.operative_receivables SET responsible_id = $1 WHERE responsible_id = $2'
      USING p_canonical_id, p_legacy_id;
  END IF;
  -- Cotizaciones: FK ON DELETE RESTRICT — sin esto la unión fallaba cuando
  -- el legacy tenía cotizaciones (el caso del cliente creado al remisionar).
  IF to_regclass('public.quotations') IS NOT NULL THEN
    EXECUTE 'UPDATE public.quotations SET responsible_id = $1 WHERE responsible_id = $2'
      USING p_canonical_id, p_legacy_id;
  END IF;
  IF to_regclass('public.expected_payments') IS NOT NULL THEN
    EXECUTE 'UPDATE public.expected_payments SET responsible_id = $1 WHERE responsible_id = $2'
      USING p_canonical_id, p_legacy_id;
  END IF;
  IF to_regclass('public.collection_touchpoints') IS NOT NULL THEN
    EXECUTE 'UPDATE public.collection_touchpoints SET responsible_id = $1 WHERE responsible_id = $2'
      USING p_canonical_id, p_legacy_id;
  END IF;
  IF to_regclass('public.imports') IS NOT NULL THEN
    EXECUTE 'UPDATE public.imports SET responsible_id = $1 WHERE responsible_id = $2'
      USING p_canonical_id, p_legacy_id;
  END IF;
  IF to_regclass('public.initial_state_details') IS NOT NULL THEN
    EXECUTE 'UPDATE public.initial_state_details SET responsible_id = $1 WHERE responsible_id = $2'
      USING p_canonical_id, p_legacy_id;
  END IF;

  -- Scores: guarda de unicidad — si choca, el del legacy se pierde (se
  -- recalcula con el botón de Cobranza).
  IF to_regclass('public.client_collection_scores') IS NOT NULL THEN
    BEGIN
      EXECUTE 'UPDATE public.client_collection_scores SET responsible_id = $1 WHERE responsible_id = $2'
        USING p_canonical_id, p_legacy_id;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  -- Reglas de tarjeta: antes se borraban en cascada. Reasignar las que no
  -- chocan con una regla igual del canónico; las duplicadas caen con el CASCADE.
  IF to_regclass('public.card_description_rules') IS NOT NULL THEN
    BEGIN
      EXECUTE 'UPDATE public.card_description_rules cdr SET responsible_id = $1 '
           || 'WHERE cdr.responsible_id = $2 AND NOT EXISTS ('
           || '  SELECT 1 FROM public.card_description_rules k '
           || '  WHERE k.user_id = cdr.user_id AND k.responsible_id = $1 '
           || '    AND coalesce(k.category_id, ''00000000-0000-0000-0000-000000000000''::uuid) '
           || '      = coalesce(cdr.category_id, ''00000000-0000-0000-0000-000000000000''::uuid))'
        USING p_canonical_id, p_legacy_id;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  -- Aliases: borrar duplicados (mismo alias case-insensitive ya en canonical) antes de mover
  DELETE FROM public.responsible_aliases
  WHERE responsible_id = p_legacy_id
    AND lower(trim(alias)) IN (
      SELECT lower(trim(alias)) FROM public.responsible_aliases WHERE responsible_id = p_canonical_id
    );

  UPDATE public.responsible_aliases
    SET responsible_id = p_canonical_id
    WHERE responsible_id = p_legacy_id;

  INSERT INTO public.responsible_aliases (user_id, responsible_id, alias, source)
  SELECT v_user_id, p_canonical_id, v_legacy_name, 'manual'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.responsible_aliases
    WHERE user_id = v_user_id
      AND lower(trim(alias)) = lower(trim(v_legacy_name))
  );

  -- Copiar el NIT al canónico si le falta
  UPDATE public.responsibles c
    SET nit = l.nit
    FROM public.responsibles l
    WHERE c.id = p_canonical_id
      AND l.id = p_legacy_id
      AND (c.nit IS NULL OR length(trim(c.nit)) = 0)
      AND l.nit IS NOT NULL AND length(trim(l.nit)) > 0;

  DELETE FROM public.responsibles WHERE id = p_legacy_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_responsibles(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.merge_responsibles(uuid, uuid) IS
  'v3: absorbe un beneficiario (legacy) como alias de otro (canonical) — atómico, reasigna todas las FKs; tablas de módulos solo si existen (to_regclass), así una tabla borrada no tumba la unión.';
