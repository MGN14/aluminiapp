-- ============================================================================
-- Reabrir un cierre de caja menor SIN disolverlo
-- ============================================================================
-- Antes: reopen_petty_cash_closing ponía closing_id = NULL en todos los
-- movimientos y BORRABA el cierre. El período reabierto dejaba de existir como
-- unidad: sus 15 movimientos caían de vuelta al listón general mezclados con
-- todo lo demás, sin forma de saber cuáles eran ni de volver a cerrarlos como
-- el mismo cierre (Nico, jul 2026: "se me mezcló con todo").
--
-- Ahora: el cierre pasa a estado 'en_edicion'. Los movimientos CONSERVAN su
-- closing_id, así que siguen agrupados e identificables; lo que cambia es que
-- vuelven a ser editables. Al terminar, reclose_petty_cash_closing recalcula
-- los saldos y lo devuelve a 'cerrado' — mismo id, mismo período.
--
-- Absorción: los movimientos que se creen DENTRO del período mientras el
-- cierre está en edición (el gasto que se olvidó cargar, que es el caso de uso
-- entero) entran al cierre al re-cerrar. Por eso reclose barre también los
-- closing_id IS NULL del rango.
-- ============================================================================

ALTER TABLE public.petty_cash_closings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'cerrado';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'petty_cash_closings_status_check'
  ) THEN
    ALTER TABLE public.petty_cash_closings
      ADD CONSTRAINT petty_cash_closings_status_check
      CHECK (status IN ('cerrado', 'en_edicion'));
  END IF;
END $$;

COMMENT ON COLUMN public.petty_cash_closings.status IS
  'cerrado = inmutable. en_edicion = reabierto por un admin: los movimientos siguen agrupados por closing_id pero vuelven a ser editables hasta que se re-cierre.';

CREATE INDEX IF NOT EXISTS idx_petty_cash_closings_user_status
  ON public.petty_cash_closings (user_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- reopen: marcar en edición (ya NO borra el cierre ni suelta los movimientos)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reopen_petty_cash_closing(uuid);

CREATE OR REPLACE FUNCTION public.reopen_petty_cash_closing(
  p_closing_id uuid
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
  v_movements_count integer;
  v_is_admin boolean := false;
BEGIN
  BEGIN
    v_is_admin := public.is_admin(v_caller);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: solo los administradores pueden reabrir cierres';
  END IF;

  SELECT user_id, status INTO v_owner, v_status
  FROM public.petty_cash_closings
  WHERE id = p_closing_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Closing not found: %', p_closing_id;
  END IF;

  IF v_status = 'en_edicion' THEN
    RAISE EXCEPTION 'Ese cierre ya está en edición';
  END IF;

  UPDATE public.petty_cash_closings
  SET status = 'en_edicion'
  WHERE id = p_closing_id;

  SELECT COUNT(*) INTO v_movements_count
  FROM public.petty_cash_movements
  WHERE closing_id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'status', 'en_edicion',
    'movements_count', v_movements_count,
    'owner_user_id', v_owner,
    'reopened_by', v_caller
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_petty_cash_closing(uuid) TO authenticated;

COMMENT ON FUNCTION public.reopen_petty_cash_closing(uuid) IS
  'Pone un cierre de caja menor en estado en_edicion (admin-only). Los movimientos conservan closing_id: siguen agrupados, solo vuelven a ser editables.';

-- ─────────────────────────────────────────────────────────────────────────────
-- reclose: recalcular y volver a cerrar el MISMO cierre
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reclose_petty_cash_closing(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.reclose_petty_cash_closing(
  p_closing_id uuid,
  p_declared_balance numeric,
  p_notes text DEFAULT NULL
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

  -- Absorber lo que se cargó durante la edición dentro del período. Es el caso
  -- de uso original: se reabre justamente para meter el gasto que faltaba.
  UPDATE public.petty_cash_movements
  SET closing_id = p_closing_id
  WHERE user_id = v_owner
    AND closing_id IS NULL
    AND date >= v_start
    AND date <= v_end;

  GET DIAGNOSTICS v_absorbed = ROW_COUNT;

  -- Recalcular sobre el set final. Neto: ingresos suman, egresos restan.
  SELECT
    COUNT(*),
    COALESCE(SUM(
      CASE WHEN kind = 'ingreso_efectivo' THEN amount ELSE -amount END
    ), 0)
  INTO v_count, v_computed
  FROM public.petty_cash_movements
  WHERE closing_id = p_closing_id;

  UPDATE public.petty_cash_closings
  SET status = 'cerrado',
      movements_count = v_count,
      computed_balance = v_computed,
      declared_balance = p_declared_balance,
      difference = p_declared_balance - v_computed,
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
    'difference', p_declared_balance - v_computed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclose_petty_cash_closing(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.reclose_petty_cash_closing(uuid, numeric, text) IS
  'Vuelve a cerrar un cierre en edición: absorbe los movimientos abiertos del período, recalcula saldo/diferencia y lo devuelve a cerrado. Admin-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Descartar un cierre en edición (vuelve al comportamiento viejo: soltar los
-- movimientos y borrar el registro). Se mantiene disponible a propósito para
-- el caso "este cierre estaba mal armado, lo rehago desde cero".
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.discard_petty_cash_closing(uuid);

CREATE OR REPLACE FUNCTION public.discard_petty_cash_closing(
  p_closing_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_freed integer;
  v_is_admin boolean := false;
BEGIN
  BEGIN
    v_is_admin := public.is_admin(v_caller);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: solo los administradores pueden descartar cierres';
  END IF;

  SELECT user_id INTO v_owner
  FROM public.petty_cash_closings
  WHERE id = p_closing_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Closing not found: %', p_closing_id;
  END IF;

  UPDATE public.petty_cash_movements
  SET closing_id = NULL
  WHERE closing_id = p_closing_id;

  GET DIAGNOSTICS v_freed = ROW_COUNT;

  DELETE FROM public.petty_cash_closings WHERE id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'movements_freed', v_freed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.discard_petty_cash_closing(uuid) TO authenticated;

COMMENT ON FUNCTION public.discard_petty_cash_closing(uuid) IS
  'Borra un cierre y suelta sus movimientos (closing_id = NULL). Admin-only. Es el comportamiento que antes tenía reopen.';

-- El cierre normal nunca debe pisar un período que está en edición: si existe
-- un cierre en_edicion solapado, close_petty_cash_period tomaría sus
-- movimientos abiertos y armaría un segundo cierre encima.
CREATE OR REPLACE FUNCTION public.close_petty_cash_period(
  p_user_id uuid,
  p_period_start date,
  p_period_end date,
  p_declared_balance numeric,
  p_notes text DEFAULT NULL
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

  v_difference := p_declared_balance - v_computed_balance;

  INSERT INTO public.petty_cash_closings (
    user_id, period_start, period_end,
    movements_count, computed_balance, declared_balance, difference, notes, status
  )
  VALUES (
    v_owner, p_period_start, p_period_end,
    v_movements_count, v_computed_balance, p_declared_balance, v_difference, p_notes, 'cerrado'
  )
  RETURNING id INTO v_closing_id;

  UPDATE public.petty_cash_movements
  SET closing_id = v_closing_id
  WHERE user_id = v_owner
    AND date >= p_period_start
    AND date <= p_period_end
    AND closing_id IS NULL;

  RETURN v_closing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_petty_cash_period(uuid, date, date, numeric, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
