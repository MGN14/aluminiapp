-- Módulo de Cobranza — overhaul post-auditoría 2026-08-12.
--
-- 1) GUARD DE FECHA en el motor de matching banco→factura.
--    El scorer usaba ABS(tx.date − issue_date): un pago 90 días ANTES de que
--    la factura existiera puntuaba igual que uno 90 días después, y no había
--    ninguna condición tx.date >= issue_date. Resultado real: $169M de pagos
--    de ene-mar 2026 quedaron vinculados a FV-2-279/FV-2-284 (emitidas en
--    abr/may) y Aluminios del Eje aparecía con saldo A FAVOR de $30M.
--    Fix: una factura solo es candidata si ya existía cuando entró el pago
--    (margen de 3 días por desfase banco vs emisión).
--
-- 2) RLS de colaboradores para collection_touchpoints y client_collection_scores.
--    Quedaron fuera de la lista de 20260507120000: un colaborador veía la
--    cartera pero no los contactos ni los scores.
--
-- 3) Aclarar qué es invoices.balance_pending para que nadie más lo lea como
--    saldo vivo (ya no lo usa ninguna superficie de cobranza).

-- =============================================================================
-- 1. suggest_invoice_matches_for_tx con guard de fecha
-- =============================================================================
-- Mismo cuerpo que 20260528120000 + el filtro de issue_date. Return type
-- idéntico → CREATE OR REPLACE es seguro.

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
  SELECT t.id, t.user_id, t.date, t.description, t.amount, t.invoice_id, t.type, t.deleted_at, t.movement_nature
  INTO v_tx
  FROM public.transactions t
  WHERE t.id = p_tx_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_tx.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF v_tx.invoice_id IS NOT NULL THEN RETURN; END IF;
  IF v_tx.type <> 'ingreso' AND COALESCE(v_tx.amount, 0) <= 0 THEN RETURN; END IF;
  -- Un traspaso/préstamo/aporte jamás es el pago de una factura: sin este
  -- check el motor podía re-vincular una consignación de caja marcada como
  -- traspaso a la factura del cliente (deshaciendo la corrección de datos).
  IF v_tx.movement_nature IS NOT NULL AND v_tx.movement_nature <> 'operativo' THEN RETURN; END IF;

  v_amount := abs(COALESCE(v_tx.amount, 0));
  v_desc := COALESCE(v_tx.description, '');
  v_desc_norm := unaccent(lower(v_desc));

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
      CASE
        WHEN inv.balance_pending IS NOT NULL AND abs(inv.balance_pending - v_amount) < 1 THEN 'exact'
        WHEN inv.total_amount IS NOT NULL AND abs(inv.total_amount - v_amount) < 1 THEN 'exact_total'
        WHEN inv.balance_pending IS NOT NULL AND inv.balance_pending BETWEEN v_amount_min AND v_amount_max THEN 'near'
        WHEN inv.total_amount IS NOT NULL AND inv.total_amount BETWEEN v_amount_min AND v_amount_max THEN 'near_total'
        ELSE 'none'
      END AS amount_match,
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
      ABS(v_tx.date - inv.issue_date) AS days_from_issue,
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
      -- GUARD DE FECHA (auditoría 2026-08-12): un pago no puede sugerirse
      -- contra una factura que aún no existía. 3 días de gracia por desfase
      -- entre fecha de emisión y fecha valor del banco.
      AND inv.issue_date <= v_tx.date + 3
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

COMMENT ON FUNCTION public.suggest_invoice_matches_for_tx(uuid) IS
  'Candidatas de matching pago->factura con scoring 0-100. Guard de fecha: la factura debe existir cuando entra el pago (issue_date <= tx.date + 3d). NO muta.';

-- =============================================================================
-- 2. Colaboradores ven touchpoints y scores del owner
-- =============================================================================
DO $$
DECLARE
  pol RECORD;
BEGIN
  -- collection_touchpoints: patrón completo (colaborador registra contactos)
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.collection_touchpoints'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.collection_touchpoints', pol.polname);
  END LOOP;
  CREATE POLICY collection_touchpoints_owner_or_collab_select
    ON public.collection_touchpoints FOR SELECT TO authenticated
    USING (user_id = public.current_data_owner());
  CREATE POLICY collection_touchpoints_owner_or_collab_insert
    ON public.collection_touchpoints FOR INSERT TO authenticated
    WITH CHECK (user_id = public.current_data_owner());
  CREATE POLICY collection_touchpoints_owner_or_collab_update
    ON public.collection_touchpoints FOR UPDATE TO authenticated
    USING (user_id = public.current_data_owner())
    WITH CHECK (user_id = public.current_data_owner());
  CREATE POLICY collection_touchpoints_owner_or_collab_delete
    ON public.collection_touchpoints FOR DELETE TO authenticated
    USING (user_id = public.current_data_owner());
  DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.collection_touchpoints;
  CREATE TRIGGER set_user_id_to_data_owner_trg
    BEFORE INSERT ON public.collection_touchpoints
    FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

  -- client_collection_scores: solo SELECT (mutaciones siguen siendo
  -- exclusivas del service_role vía score-collection-clients).
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.client_collection_scores'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.client_collection_scores', pol.polname);
  END LOOP;
  CREATE POLICY client_collection_scores_owner_or_collab_select
    ON public.client_collection_scores FOR SELECT TO authenticated
    USING (user_id = public.current_data_owner());
END $$;

-- =============================================================================
-- 3. balance_pending: dejar claro qué es (y qué NO es)
-- =============================================================================
COMMENT ON COLUMN public.invoices.balance_pending IS
  'Saldo crudo segun Siigo al momento del ultimo sync. NO baja al conciliar pagos en la app. NO usar como saldo vivo: la fuente de verdad es computeReceivables (_shared/receivables.ts) / lib/clientReceivables.ts. Solo sirve como referencia de cuadre app-vs-Siigo y pre-filtro barato.';
