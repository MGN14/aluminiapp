-- Cierre de caja menor: tabla `petty_cash_closings` + columna `closing_id`
-- en `petty_cash_movements` que vincula cada movimiento a su cierre.
--
-- Caso de uso: cada mes (o cuando el dueño lo decida), se "cierra" la caja
-- menor: se cuenta la plata física, se compara contra el saldo computado
-- y se registra la diferencia. Movimientos cerrados quedan inmutables.

CREATE TABLE IF NOT EXISTS public.petty_cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- Movimientos en el período (snapshot al cerrar).
  movements_count integer NOT NULL DEFAULT 0,
  -- Saldo computado a partir de los movimientos (suma de ingresos − egresos).
  computed_balance numeric(14, 2) NOT NULL DEFAULT 0,
  -- Saldo físico declarado por el usuario al cerrar.
  declared_balance numeric(14, 2) NOT NULL DEFAULT 0,
  -- difference = declared − computed. Positivo = sobrante; negativo = faltante.
  difference numeric(14, 2) NOT NULL DEFAULT 0,
  notes text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_closings_user_period
  ON public.petty_cash_closings (user_id, period_end DESC);

ALTER TABLE public.petty_cash_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own closings" ON public.petty_cash_closings;
CREATE POLICY "Users can view their own closings"
  ON public.petty_cash_closings
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own closings" ON public.petty_cash_closings;
CREATE POLICY "Users can insert their own closings"
  ON public.petty_cash_closings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Notas se permiten editar (no destructivo); todo lo demás es inmutable
-- una vez cerrado.
DROP POLICY IF EXISTS "Users can update notes of their own closings" ON public.petty_cash_closings;
CREATE POLICY "Users can update notes of their own closings"
  ON public.petty_cash_closings
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Columna closing_id en movimientos. NULL = movimiento abierto, editable.
-- NOT NULL = movimiento incluido en un cierre, inmutable.
ALTER TABLE public.petty_cash_movements
  ADD COLUMN IF NOT EXISTS closing_id uuid
  REFERENCES public.petty_cash_closings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_petty_cash_movements_closing
  ON public.petty_cash_movements (closing_id) WHERE closing_id IS NOT NULL;

COMMENT ON COLUMN public.petty_cash_movements.closing_id IS
  'FK a petty_cash_closings. NULL = movimiento abierto. NOT NULL = parte de un cierre, no editable.';

-- Función transaccional: crea el cierre y marca todos los movimientos del
-- período como cerrados, en una sola transacción.
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
BEGIN
  -- Validar dueño
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Computar resumen de movimientos abiertos del período (closing_id IS NULL).
  SELECT
    COUNT(*),
    -- Para gasto_efectivo: amount es positivo y representa egreso (resta).
    -- Si más adelante se agregan ingresos a caja, ajustar signo aquí.
    COALESCE(SUM(-amount), 0)
  INTO v_movements_count, v_computed_balance
  FROM public.petty_cash_movements
  WHERE user_id = p_user_id
    AND date >= p_period_start
    AND date <= p_period_end
    AND closing_id IS NULL;

  IF v_movements_count = 0 THEN
    RAISE EXCEPTION 'No hay movimientos abiertos en el período seleccionado';
  END IF;

  v_difference := p_declared_balance - v_computed_balance;

  -- Crear el cierre
  INSERT INTO public.petty_cash_closings (
    user_id, period_start, period_end,
    movements_count, computed_balance, declared_balance, difference, notes
  )
  VALUES (
    p_user_id, p_period_start, p_period_end,
    v_movements_count, v_computed_balance, p_declared_balance, v_difference, p_notes
  )
  RETURNING id INTO v_closing_id;

  -- Marcar movimientos como cerrados
  UPDATE public.petty_cash_movements
  SET closing_id = v_closing_id
  WHERE user_id = p_user_id
    AND date >= p_period_start
    AND date <= p_period_end
    AND closing_id IS NULL;

  RETURN v_closing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_petty_cash_period(uuid, date, date, numeric, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
