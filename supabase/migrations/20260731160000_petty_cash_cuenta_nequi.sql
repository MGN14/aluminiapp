-- ============================================================================
-- Caja menor con más de una cuenta (efectivo + Nequi)
-- ============================================================================
-- Nico, jul 2026: "necesito agregar en caja menor, Nequi (otra cuenta), no
-- tenemos en cuenta cuánto debe ir en esa cuenta y quiero revisarlo ahí".
--
-- Hasta ahora Caja Menor asumía UNA sola bolsa: plata física. El saldo era
-- ingresos − egresos y el cierre declaraba "cuántos pesos hay en la caja".
-- Con Nequi adentro eso se rompe solo: los movimientos de Nequi entrarían al
-- mismo saldo computado, pero el saldo declarado sigue siendo el efectivo que
-- se cuenta con la mano. La diferencia daría siempre mal. Por eso la cuenta no
-- puede ser solo una etiqueta: el cierre tiene que cuadrar CADA cuenta aparte.
--
-- Modelo:
--   · petty_cash_movements.cuenta — de dónde salió / a dónde entró la plata.
--   · petty_cash_closings.saldos  — jsonb con computado/declarado/diferencia
--     POR cuenta. Las columnas computed_balance / declared_balance /
--     difference se conservan como el TOTAL (no rompen nada de lo existente:
--     PyG, balance, PDFs viejos y reportes las siguen leyendo igual).
--
-- Agregar una cuenta nueva (Daviplata, etc.) no necesita migración: es un
-- valor más en la constante del frontend. Por eso no hay CHECK cerrado acá.
-- ============================================================================

ALTER TABLE public.petty_cash_movements
  ADD COLUMN IF NOT EXISTS cuenta text NOT NULL DEFAULT 'efectivo';

COMMENT ON COLUMN public.petty_cash_movements.cuenta IS
  'Cuenta de la que sale o entra la plata: efectivo | nequi | (futuras). Cada una cuadra por separado en el cierre.';

CREATE INDEX IF NOT EXISTS idx_petty_cash_movements_user_cuenta
  ON public.petty_cash_movements (user_id, cuenta);

ALTER TABLE public.petty_cash_closings
  ADD COLUMN IF NOT EXISTS saldos jsonb;

COMMENT ON COLUMN public.petty_cash_closings.saldos IS
  'Desglose por cuenta: {"efectivo":{"computado":n,"declarado":n,"diferencia":n},"nequi":{...}}. computed_balance/declared_balance/difference siguen siendo el TOTAL.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cálculo del desglose por cuenta de un conjunto de movimientos.
-- Se usa igual en el cierre nuevo y en el re-cierre → una sola fuente de verdad.
-- p_declarados: {"efectivo": 800000, "nequi": 240000}. Cuenta sin declarar
-- queda con declarado = 0 (y la diferencia lo muestra), nunca se inventa.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.petty_cash_saldos_por_cuenta(
  p_closing_id uuid,
  p_declarados jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      x.cuenta,
      jsonb_build_object(
        'computado', x.computado,
        'declarado', x.declarado,
        'diferencia', x.declarado - x.computado
      )
    ),
    '{}'::jsonb
  )
  FROM (
    SELECT
      m.cuenta,
      COALESCE(SUM(
        CASE WHEN m.kind = 'ingreso_efectivo' THEN m.amount ELSE -m.amount END
      ), 0) AS computado,
      COALESCE((p_declarados ->> m.cuenta)::numeric, 0) AS declarado
    FROM public.petty_cash_movements m
    WHERE m.closing_id = p_closing_id
    GROUP BY m.cuenta
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.petty_cash_saldos_por_cuenta(uuid, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- close_petty_cash_period: ahora acepta el declarado POR CUENTA.
-- p_declared_balance sigue siendo el total (compatibilidad: si no se manda el
-- desglose, todo se atribuye a 'efectivo' como venía funcionando).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_petty_cash_period(
  p_user_id uuid,
  p_period_start date,
  p_period_end date,
  p_declared_balance numeric,
  p_notes text DEFAULT NULL,
  p_declarados_por_cuenta jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closing_id uuid;
  v_movements_count integer;
  v_computed_balance numeric;
  v_difference numeric;
  v_owner uuid;
  v_en_edicion uuid;
  v_declarados jsonb;
  v_declared_total numeric;
BEGIN
  v_owner := public.current_data_owner();

  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el administrador puede cerrar la caja menor';
  END IF;

  SELECT id INTO v_en_edicion
  FROM public.petty_cash_closings
  WHERE user_id = v_owner
    AND status = 'en_edicion'
    AND period_start <= p_period_end
    AND period_end >= p_period_start
  LIMIT 1;

  IF v_en_edicion IS NOT NULL THEN
    RAISE EXCEPTION 'Hay un cierre en edición que se solapa con ese período. Terminá de editarlo y guardalo antes de cerrar uno nuevo.';
  END IF;

  -- Sin desglose = comportamiento viejo: todo el declarado es efectivo.
  v_declarados := COALESCE(
    p_declarados_por_cuenta,
    jsonb_build_object('efectivo', p_declared_balance)
  );

  SELECT COALESCE(SUM((value)::numeric), 0)
  INTO v_declared_total
  FROM jsonb_each_text(v_declarados);

  SELECT
    COUNT(*),
    COALESCE(SUM(
      CASE WHEN kind = 'ingreso_efectivo' THEN amount ELSE -amount END
    ), 0)
  INTO v_movements_count, v_computed_balance
  FROM public.petty_cash_movements
  WHERE user_id = v_owner
    AND date >= p_period_start
    AND date <= p_period_end
    AND closing_id IS NULL;

  IF v_movements_count = 0 THEN
    RAISE EXCEPTION 'No hay movimientos abiertos en el período seleccionado';
  END IF;

  v_difference := v_declared_total - v_computed_balance;

  INSERT INTO public.petty_cash_closings (
    user_id, period_start, period_end,
    movements_count, computed_balance, declared_balance, difference, notes, status
  )
  VALUES (
    v_owner, p_period_start, p_period_end,
    v_movements_count, v_computed_balance, v_declared_total, v_difference, p_notes, 'cerrado'
  )
  RETURNING id INTO v_closing_id;

  UPDATE public.petty_cash_movements
  SET closing_id = v_closing_id
  WHERE user_id = v_owner
    AND date >= p_period_start
    AND date <= p_period_end
    AND closing_id IS NULL;

  -- El desglose se calcula DESPUÉS de asignar closing_id (necesita los
  -- movimientos ya marcados).
  UPDATE public.petty_cash_closings
  SET saldos = public.petty_cash_saldos_por_cuenta(v_closing_id, v_declarados)
  WHERE id = v_closing_id;

  RETURN v_closing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_petty_cash_period(uuid, date, date, numeric, text, jsonb)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- reclose: mismo tratamiento por cuenta.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reclose_petty_cash_closing(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.reclose_petty_cash_closing(
  p_closing_id uuid,
  p_declared_balance numeric,
  p_notes text DEFAULT NULL,
  p_declarados_por_cuenta jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_start date;
  v_end date;
  v_absorbed integer;
  v_count integer;
  v_computed numeric;
  v_is_admin boolean := false;
  v_declarados jsonb;
  v_declared_total numeric;
  v_saldos jsonb;
BEGIN
  BEGIN
    v_is_admin := public.is_admin(v_caller);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: solo los administradores pueden cerrar la caja';
  END IF;

  SELECT user_id, status, period_start, period_end
  INTO v_owner, v_status, v_start, v_end
  FROM public.petty_cash_closings
  WHERE id = p_closing_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Closing not found: %', p_closing_id;
  END IF;

  IF v_status <> 'en_edicion' THEN
    RAISE EXCEPTION 'Ese cierre no está en edición';
  END IF;

  UPDATE public.petty_cash_movements
  SET closing_id = p_closing_id
  WHERE user_id = v_owner
    AND closing_id IS NULL
    AND date >= v_start
    AND date <= v_end;

  GET DIAGNOSTICS v_absorbed = ROW_COUNT;

  SELECT
    COUNT(*),
    COALESCE(SUM(
      CASE WHEN kind = 'ingreso_efectivo' THEN amount ELSE -amount END
    ), 0)
  INTO v_count, v_computed
  FROM public.petty_cash_movements
  WHERE closing_id = p_closing_id;

  v_declarados := COALESCE(
    p_declarados_por_cuenta,
    jsonb_build_object('efectivo', p_declared_balance)
  );

  SELECT COALESCE(SUM((value)::numeric), 0)
  INTO v_declared_total
  FROM jsonb_each_text(v_declarados);

  v_saldos := public.petty_cash_saldos_por_cuenta(p_closing_id, v_declarados);

  UPDATE public.petty_cash_closings
  SET status = 'cerrado',
      movements_count = v_count,
      computed_balance = v_computed,
      declared_balance = v_declared_total,
      difference = v_declared_total - v_computed,
      saldos = v_saldos,
      notes = COALESCE(p_notes, notes),
      closed_at = now()
  WHERE id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'status', 'cerrado',
    'movements_count', v_count,
    'movements_absorbed', v_absorbed,
    'computed_balance', v_computed,
    'difference', v_declared_total - v_computed,
    'saldos', v_saldos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclose_petty_cash_closing(uuid, numeric, text, jsonb) TO authenticated;

-- Backfill: los cierres ya hechos son 100% efectivo (era la única cuenta).
UPDATE public.petty_cash_closings
SET saldos = jsonb_build_object(
  'efectivo', jsonb_build_object(
    'computado', computed_balance,
    'declarado', declared_balance,
    'diferencia', difference
  )
)
WHERE saldos IS NULL;

NOTIFY pgrst, 'reload schema';
