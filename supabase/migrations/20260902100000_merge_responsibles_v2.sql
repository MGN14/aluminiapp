-- ============================================================================
-- merge_responsibles v2 — la unión de beneficiarios FALLABA (Nico 2026-09-02)
--
-- Causa: el RPC borra el beneficiario legacy al final, pero quotations tiene
-- FK ON DELETE RESTRICT y el RPC no reasignaba cotizaciones → si el legacy
-- tenía UNA cotización (justo el caso del cliente creado al remisionar/
-- cotizar "como lo conocemos"), el DELETE reventaba y TODA la unión se
-- revertía. Además varias tablas ni se reasignaban: los acuerdos de cobro,
-- touchpoints y scores quedaban en NULL (historial perdido) y las reglas de
-- tarjeta se BORRABAN en cascada.
--
-- v2 reasigna TODO lo que referencia responsibles:
--   quotations (RESTRICT — el bloqueador), expected_payments,
--   collection_touchpoints, client_collection_scores, income_receipts,
--   imports, card_description_rules, initial_state_details.
-- Las tablas con posibles conflictos de unicidad van con guardas.
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

  -- Reasignar refs en todas las tablas con FK responsible_id
  UPDATE public.invoices              SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.transactions          SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.transactions          SET operative_responsible_id = p_canonical_id WHERE operative_responsible_id = p_legacy_id;
  UPDATE public.cash_movements        SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.petty_cash_movements  SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.remisiones            SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.reconciliation_rules  SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.credits               SET default_responsible_id   = p_canonical_id WHERE default_responsible_id   = p_legacy_id;
  UPDATE public.operative_receivables SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;

  -- v2: las que faltaban.
  -- Cotizaciones — FK ON DELETE RESTRICT: ESTA era la que hacía fallar la
  -- unión completa cuando el legacy tenía cotizaciones.
  UPDATE public.quotations            SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.expected_payments     SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.collection_touchpoints SET responsible_id          = p_canonical_id WHERE responsible_id          = p_legacy_id;
  UPDATE public.income_receipts       SET payer_responsible_id     = p_canonical_id WHERE payer_responsible_id     = p_legacy_id;
  UPDATE public.imports               SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.initial_state_details SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;

  -- Scores de cobranza: reasignar con guarda por si hay unicidad por cliente;
  -- si choca, el del legacy se pierde (se recalcula solo con el botón).
  BEGIN
    UPDATE public.client_collection_scores SET responsible_id = p_canonical_id WHERE responsible_id = p_legacy_id;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Reglas de tarjeta: antes se borraban en cascada con el legacy. Reasignar
  -- las que no chocan con una regla igual del canónico (índice único sobre
  -- coalesce(category, responsible)); las duplicadas caen con el CASCADE.
  BEGIN
    UPDATE public.card_description_rules cdr
      SET responsible_id = p_canonical_id
      WHERE cdr.responsible_id = p_legacy_id
        AND NOT EXISTS (
          SELECT 1 FROM public.card_description_rules k
          WHERE k.user_id = cdr.user_id
            AND k.responsible_id = p_canonical_id
            AND coalesce(k.category_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(cdr.category_id, '00000000-0000-0000-0000-000000000000'::uuid)
        );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Aliases: borrar duplicados (mismo alias case-insensitive ya en canonical) antes de mover
  DELETE FROM public.responsible_aliases
  WHERE responsible_id = p_legacy_id
    AND lower(trim(alias)) IN (
      SELECT lower(trim(alias)) FROM public.responsible_aliases WHERE responsible_id = p_canonical_id
    );

  -- Mover el resto al canonical
  UPDATE public.responsible_aliases
    SET responsible_id = p_canonical_id
    WHERE responsible_id = p_legacy_id;

  -- Crear alias del nombre del legacy → canonical (si no existe ya)
  INSERT INTO public.responsible_aliases (user_id, responsible_id, alias, source)
  SELECT v_user_id, p_canonical_id, v_legacy_name, 'manual'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.responsible_aliases
    WHERE user_id = v_user_id
      AND lower(trim(alias)) = lower(trim(v_legacy_name))
  );

  -- Copiar el NIT al canónico si le falta (el auto-creado desde facturas suele
  -- traerlo y el creado a mano al remisionar no).
  UPDATE public.responsibles c
    SET nit = l.nit
    FROM public.responsibles l
    WHERE c.id = p_canonical_id
      AND l.id = p_legacy_id
      AND (c.nit IS NULL OR length(trim(c.nit)) = 0)
      AND l.nit IS NOT NULL AND length(trim(l.nit)) > 0;

  -- Borrar el legacy responsible
  DELETE FROM public.responsibles WHERE id = p_legacy_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_responsibles(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.merge_responsibles(uuid, uuid) IS
  'v2: absorbe un beneficiario (legacy) como alias de otro (canonical) — atómico, reasigna TODAS las FKs (incl. quotations RESTRICT que bloqueaba la unión) y borra el legacy.';
