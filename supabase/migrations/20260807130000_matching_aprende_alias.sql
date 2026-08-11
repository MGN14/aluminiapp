-- Motor de ventas, Fase 3 (Nico, 2026-08-07): el scorer reconoce ALIAS.
--
-- Cuando Nico confirma un match, el frontend guarda el fragmento
-- identificable de la descripción como alias del cliente
-- (responsible_aliases, source 'auto-detected'). Este scorer lo aprovecha:
-- si un alias del cliente de la factura aparece en la descripción del pago,
-- señal client_match='alias' (+25) — el sistema mejora con cada confirmación.
--
-- CREATE OR REPLACE fiel al original (20260528120000) + la señal nueva.
-- Cambios exactos: inv.responsible_id en el CTE, rama 'alias' en client_match,
-- y su peso en el score. Nada más se toca.

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

  -- Rango para "monto cercano" ±10%
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
      -- 3. Cliente en descripción: nombre, NIT, o ALIAS APRENDIDO (Fase 3)
      CASE
        WHEN inv.counterparty_name IS NOT NULL AND length(public.normalize_client_name(inv.counterparty_name)) >= 4
          AND position(public.normalize_client_name(inv.counterparty_name) IN public.normalize_client_name(v_desc)) > 0
        THEN 'name'
        WHEN inv.counterparty_nit IS NOT NULL
          AND length(regexp_replace(inv.counterparty_nit, '[^0-9]', '', 'g')) >= 6
          AND position(regexp_replace(inv.counterparty_nit, '[^0-9]', '', 'g') IN regexp_replace(v_desc, '[^0-9]', '', 'g')) > 0
        THEN 'nit'
        WHEN inv.responsible_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.responsible_aliases ra
          WHERE ra.responsible_id = inv.responsible_id
            AND length(public.normalize_client_name(ra.alias)) >= 4
            AND position(public.normalize_client_name(ra.alias) IN public.normalize_client_name(v_desc)) > 0
        )
        THEN 'alias'
        ELSE 'none'
      END AS client_match,
      -- 4. Proximidad de fecha
      ABS(v_tx.date - inv.issue_date) AS days_from_issue,
      -- 5. Match con expected_payment
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
          WHEN 'alias' THEN 25
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
  WHERE scored.raw_score >= 30
  ORDER BY scored.raw_score DESC
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_invoice_matches_for_tx(uuid) TO authenticated;

COMMENT ON FUNCTION public.suggest_invoice_matches_for_tx(uuid) IS
  'Hasta 5 facturas candidatas para un ingreso, scoring 0-100. Reconoce alias aprendidos de responsible_aliases (client_match=alias, +25). NO muta.';
