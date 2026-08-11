-- Motor de matching banco→factura, Fase 1 (Nico, 2026-08-07):
-- el match AUTO completaba la factura pero NO el beneficiario ni la
-- categoría — la fila seguía "pendiente" en Conciliación aunque el motor ya
-- sabía exactamente de quién era el pago. Hacía el trabajo difícil y dejaba
-- sin hacer el fácil.
--
-- Ahora el path AUTO (confianza ≥80, único en su top) también setea
-- responsible_id (el de la factura) y category_id (Ventas) cuando están
-- NULL. NUNCA pisa lo que ya esté puesto a mano (COALESCE).
-- Incluye backfill one-shot para los matches ya aplicados.

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
  v_inv_responsible uuid;
  v_ventas_cat uuid;
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
  SELECT count(*) INTO v_top_count
  FROM public.suggest_invoice_matches_for_tx(p_tx_id)
  WHERE confidence >= v_best.confidence - 5 AND confidence >= 80;

  -- AUTO (≥80 y único en su top)
  IF v_best.confidence >= 80 AND v_top_count <= 1 THEN
    SELECT responsible_id INTO v_inv_responsible
    FROM public.invoices WHERE id = v_best.invoice_id;

    SELECT id INTO v_ventas_cat
    FROM public.categories
    WHERE user_id = v_user_id AND active AND lower(name) LIKE '%venta%'
    ORDER BY name
    LIMIT 1;

    UPDATE public.transactions t
    SET invoice_id = v_best.invoice_id,
        -- El pago es de esta factura ⇒ el beneficiario es su cliente y la
        -- categoría es Ventas. Solo si estaban vacíos: lo manual manda.
        responsible_id = COALESCE(t.responsible_id, v_inv_responsible),
        category_id = COALESCE(t.category_id, v_ventas_cat)
    WHERE t.id = p_tx_id;

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

-- ── Backfill one-shot: ingresos YA vinculados a factura de venta pero con ──
-- ── beneficiario o categoría vacíos (matches viejos + vinculaciones a mano) ──

UPDATE public.transactions t
SET responsible_id = inv.responsible_id
FROM public.invoices inv
WHERE t.invoice_id = inv.id
  AND inv.type = 'venta'
  AND t.deleted_at IS NULL
  AND t.responsible_id IS NULL
  AND inv.responsible_id IS NOT NULL;

UPDATE public.transactions t
SET category_id = c.id
FROM public.invoices inv, public.categories c
WHERE t.invoice_id = inv.id
  AND inv.type = 'venta'
  AND t.deleted_at IS NULL
  AND t.category_id IS NULL
  AND c.user_id = t.user_id
  AND c.active
  AND lower(c.name) LIKE '%venta%';

NOTIFY pgrst, 'reload schema';
