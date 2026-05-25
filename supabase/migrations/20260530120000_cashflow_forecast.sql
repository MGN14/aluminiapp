-- Cashflow forecast: predicción día por día combinando múltiples fuentes.
--
-- Fuentes consideradas:
--   1. expected_payments (promesas de pago) → alta confianza
--   2. invoices tipo venta con balance_pending + due_date → ajustadas por client_collection_score
--   3. invoices tipo compra con balance_pending + due_date → outflow probable
--   4. Tendencia de gasto operativo recurrente (promedio 90 días, sin facturas vinculadas)
--   5. credit_payments programados (cuota fija de créditos activos)
--
-- Output: serie diaria por hasta p_horizon_days días con desglose y confianza.

CREATE OR REPLACE FUNCTION public.forecast_cashflow(
  p_user_id uuid DEFAULT NULL,
  p_horizon_days integer DEFAULT 60
)
RETURNS TABLE (
  fecha date,
  expected_inflows numeric,
  expected_outflows numeric,
  net numeric,
  cumulative_balance numeric,
  inflow_sources jsonb,
  outflow_sources jsonb,
  confidence smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_today date := CURRENT_DATE;
  v_horizon date;
  v_recurring_outflow_daily numeric := 0;
  v_initial_balance numeric := 0;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No user id and no auth.uid()';
  END IF;
  v_horizon := v_today + (LEAST(p_horizon_days, 180))::integer;

  -- Saldo inicial: último balance conocido de transactions o 0
  SELECT COALESCE(balance, 0) INTO v_initial_balance
  FROM public.transactions
  WHERE user_id = v_user
    AND deleted_at IS NULL
    AND balance IS NOT NULL
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  -- Gasto operativo recurrente: promedio diario de últimos 90 días excluyendo
  -- transacciones vinculadas a facturas (que ya las contamos aparte).
  SELECT COALESCE(
    SUM(ABS(amount)) FILTER (WHERE COALESCE(amount, 0) < 0) / GREATEST(90, 1),
    0
  ) INTO v_recurring_outflow_daily
  FROM public.transactions
  WHERE user_id = v_user
    AND deleted_at IS NULL
    AND date >= v_today - 90
    AND date < v_today
    AND invoice_id IS NULL;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_today, v_horizon, '1 day'::interval)::date AS d
  ),
  -- 1. Expected payments (promesas pendientes)
  ep_per_day AS (
    SELECT
      ep.due_date::date AS d,
      SUM(ep.amount) AS total,
      jsonb_agg(jsonb_build_object('amount', ep.amount, 'invoice_id', ep.invoice_id, 'responsible_id', ep.responsible_id)) AS detail
    FROM public.expected_payments ep
    WHERE ep.user_id = v_user
      AND ep.status = 'pendiente'
      AND ep.due_date::date BETWEEN v_today AND v_horizon
    GROUP BY ep.due_date::date
  ),
  -- 2. Facturas venta vivas con due_date, ajustadas por score IA del cliente
  -- Si no hay score, asume 60 (medio). Si no hay due_date, usa issue_date + 30 días.
  inv_venta_per_day AS (
    SELECT
      COALESCE(inv.due_date::date,
               (inv.issue_date + COALESCE(inv.dias_credito, 30) * INTERVAL '1 day')::date) AS d,
      SUM(inv.balance_pending * COALESCE(ccs.score, 60) / 100.0) AS total_weighted,
      SUM(inv.balance_pending) AS total_raw,
      jsonb_agg(jsonb_build_object(
        'invoice_id', inv.id,
        'invoice_number', inv.invoice_number,
        'counterparty', inv.counterparty_name,
        'pending', inv.balance_pending,
        'score', COALESCE(ccs.score, 60)
      )) AS detail
    FROM public.invoices inv
    LEFT JOIN public.client_collection_scores ccs
      ON ccs.user_id = inv.user_id
      AND (
        (ccs.responsible_id IS NOT NULL AND ccs.responsible_id = inv.responsible_id)
        OR (ccs.responsible_id IS NULL AND lower(ccs.client_name) = lower(inv.counterparty_name))
      )
    WHERE inv.user_id = v_user
      AND inv.type = 'venta'
      AND inv.voided_at IS NULL
      AND inv.balance_pending > 0
      AND COALESCE(inv.due_date::date,
                   (inv.issue_date + COALESCE(inv.dias_credito, 30) * INTERVAL '1 day')::date)
          BETWEEN v_today AND v_horizon
    GROUP BY 1
  ),
  -- 3. Facturas compra con balance_pending + due_date
  inv_compra_per_day AS (
    SELECT
      COALESCE(inv.due_date::date,
               (inv.issue_date + COALESCE(inv.dias_credito, 30) * INTERVAL '1 day')::date) AS d,
      SUM(inv.balance_pending) AS total,
      jsonb_agg(jsonb_build_object(
        'invoice_id', inv.id,
        'invoice_number', inv.invoice_number,
        'seller', inv.counterparty_name,
        'pending', inv.balance_pending
      )) AS detail
    FROM public.invoices inv
    WHERE inv.user_id = v_user
      AND inv.type = 'compra'
      AND inv.voided_at IS NULL
      AND inv.balance_pending > 0
      AND COALESCE(inv.due_date::date,
                   (inv.issue_date + COALESCE(inv.dias_credito, 30) * INTERVAL '1 day')::date)
          BETWEEN v_today AND v_horizon
    GROUP BY 1
  ),
  -- 4. Credit payments programados (estimación: cuota mensual fija = principal / term_months * 1.1)
  credit_per_day AS (
    SELECT
      (c.first_payment_date + (i * INTERVAL '1 month'))::date AS d,
      SUM(c.principal / NULLIF(c.term_months, 0) * 1.1) AS total,
      jsonb_agg(jsonb_build_object('credit_id', c.id, 'name', c.name)) AS detail
    FROM public.credits c
    CROSS JOIN generate_series(0, 24) AS i  -- proyectar 24 cuotas adelante (max 2 años)
    WHERE c.user_id = v_user
      AND c.status = 'active'
      AND c.first_payment_date IS NOT NULL
      AND c.term_months IS NOT NULL
      AND c.term_months > 0
      AND (c.first_payment_date + (i * INTERVAL '1 month'))::date BETWEEN v_today AND v_horizon
      AND i < c.term_months
    GROUP BY 1
  ),
  joined AS (
    SELECT
      days.d AS fecha,
      COALESCE(ep_per_day.total, 0)
        + COALESCE(inv_venta_per_day.total_weighted, 0) AS inflows,
      COALESCE(inv_compra_per_day.total, 0)
        + COALESCE(credit_per_day.total, 0)
        + v_recurring_outflow_daily AS outflows,
      jsonb_build_object(
        'expected_payments', COALESCE(ep_per_day.total, 0),
        'invoices_venta_weighted', COALESCE(inv_venta_per_day.total_weighted, 0),
        'invoices_venta_raw', COALESCE(inv_venta_per_day.total_raw, 0),
        'detail_expected', COALESCE(ep_per_day.detail, '[]'::jsonb),
        'detail_invoices', COALESCE(inv_venta_per_day.detail, '[]'::jsonb)
      ) AS in_src,
      jsonb_build_object(
        'invoices_compra', COALESCE(inv_compra_per_day.total, 0),
        'credit_payments', COALESCE(credit_per_day.total, 0),
        'recurring_estimated', v_recurring_outflow_daily,
        'detail_compras', COALESCE(inv_compra_per_day.detail, '[]'::jsonb),
        'detail_credits', COALESCE(credit_per_day.detail, '[]'::jsonb)
      ) AS out_src
    FROM days
    LEFT JOIN ep_per_day ON ep_per_day.d = days.d
    LEFT JOIN inv_venta_per_day ON inv_venta_per_day.d = days.d
    LEFT JOIN inv_compra_per_day ON inv_compra_per_day.d = days.d
    LEFT JOIN credit_per_day ON credit_per_day.d = days.d
  )
  SELECT
    joined.fecha,
    joined.inflows::numeric AS expected_inflows,
    joined.outflows::numeric AS expected_outflows,
    (joined.inflows - joined.outflows)::numeric AS net,
    (v_initial_balance + SUM(joined.inflows - joined.outflows) OVER (ORDER BY joined.fecha))::numeric AS cumulative_balance,
    joined.in_src,
    joined.out_src,
    -- Confianza: baja linealmente con días futuros. Día 1 = 90%, día 60 = 50%.
    GREATEST(50, 90 - (joined.fecha - v_today))::smallint AS confidence
  FROM joined
  ORDER BY joined.fecha;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forecast_cashflow(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.forecast_cashflow(uuid, integer) IS
  'Predicción día por día (hasta 180 días) combinando promesas, facturas vivas con scoring IA, créditos y gasto recurrente.';

-- Función helper: resumen agregado por mes para NicoPronosticos
CREATE OR REPLACE FUNCTION public.forecast_cashflow_monthly(
  p_user_id uuid DEFAULT NULL,
  p_months_ahead integer DEFAULT 6
)
RETURNS TABLE (
  month_start date,
  month_label text,
  total_inflows numeric,
  total_outflows numeric,
  net numeric,
  closing_balance numeric,
  avg_confidence smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH daily AS (
    SELECT * FROM public.forecast_cashflow(p_user_id, LEAST(p_months_ahead * 31, 180))
  )
  SELECT
    date_trunc('month', fecha)::date AS month_start,
    to_char(date_trunc('month', fecha), 'TMMonth YYYY') AS month_label,
    SUM(expected_inflows)::numeric AS total_inflows,
    SUM(expected_outflows)::numeric AS total_outflows,
    SUM(net)::numeric AS net,
    -- closing_balance del último día del mes
    (array_agg(cumulative_balance ORDER BY fecha DESC))[1]::numeric AS closing_balance,
    AVG(confidence)::smallint AS avg_confidence
  FROM daily
  GROUP BY date_trunc('month', fecha)
  ORDER BY month_start;
$$;

GRANT EXECUTE ON FUNCTION public.forecast_cashflow_monthly(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.forecast_cashflow_monthly(uuid, integer) IS
  'Agrega forecast_cashflow por mes para vistas resumidas (NicoPronosticos).';
