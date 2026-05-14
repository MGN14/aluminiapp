-- HOTFIX: el cierre de Caja Menor calcula mal el saldo computado.
--
-- Bug 1 — signo de ingresos: close_petty_cash_period hacía SUM(-amount)
-- sobre TODOS los movimientos del período. El comentario del código ya
-- admitía "si más adelante se agregan ingresos a caja, ajustar signo aquí"
-- — ya se agregaron ingresos (kind='ingreso_efectivo') y nunca se ajustó.
-- Resultado: ingresos $8.222.900 + egresos $7.422.900 se sumaban como
-- -$15.645.800 en lugar del neto correcto +$800.000. Al declarar el saldo
-- físico real, siempre arrojaba una diferencia gigante falsa.
--
-- Bug 2 — owner vs colaborador: la validación era auth.uid() = p_user_id
-- y el cómputo filtraba WHERE user_id = p_user_id. El frontend pasa
-- p_user_id = user.id, así que para un colaborador filtraba por su propio
-- id (0 movimientos, son del owner) → "No hay movimientos". Nico además
-- pidió que SOLO el administrador pueda cerrar caja.
--
-- Fix:
--   - El saldo computado = SUM(ingresos) - SUM(egresos), por kind.
--   - Restringir el cierre al owner: current_data_owner() = auth.uid().
--     Colaboradores reciben un error claro en lugar de "No hay movimientos".
--   - Computar y cerrar sobre current_data_owner() (el owner real) para que
--     funcione aunque el frontend mande p_user_id propio.

DROP FUNCTION IF EXISTS public.close_petty_cash_period(uuid, date, date, numeric, text);

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
BEGIN
  -- El dueño efectivo de los datos. Para owner = su auth.uid(). Para
  -- colaborador = el owner que lo invitó.
  v_owner := public.current_data_owner();

  -- Solo el ADMINISTRADOR (dueño de la cuenta) puede cerrar la caja.
  -- Un colaborador tiene current_data_owner() ≠ auth.uid().
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el administrador puede cerrar la caja menor';
  END IF;

  -- Computar resumen de movimientos abiertos del período. El saldo
  -- computado es el NETO: ingresos suman, egresos (gasto/cuenta de cobro)
  -- restan.
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
    movements_count, computed_balance, declared_balance, difference, notes
  )
  VALUES (
    v_owner, p_period_start, p_period_end,
    v_movements_count, v_computed_balance, p_declared_balance, v_difference, p_notes
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
