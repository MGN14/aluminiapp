-- Migration: backfill `balance` en transactions de CSVs semanales ya subidos.
--
-- Contexto: el edge function parse-bancolombia-csv NO populaba balance hasta
-- esta sesión. Eso causaba que el chart "Saldo en el tiempo" (Dashboard)
-- ignorara todos los movimientos subidos por CSV (filtra balance != null).
--
-- Esta migration calcula running balance para todas las transactions con
-- balance NULL, por usuario, ordenadas cronológicamente, partiendo del
-- último balance conocido (si existe) o de 0.
--
-- Es idempotente: si la corremos otra vez no hace nada (porque ya
-- todas tendrían balance no-null tras la primera pasada).

CREATE OR REPLACE FUNCTION public.backfill_running_balance(p_user_id uuid)
RETURNS TABLE(updated_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seed numeric := 0;
  v_first_null_date date;
  v_count int := 0;
BEGIN
  -- 1. Encontrar la fecha más antigua con balance NULL para este usuario
  SELECT MIN(date) INTO v_first_null_date
  FROM public.transactions
  WHERE user_id = p_user_id
    AND deleted_at IS NULL
    AND balance IS NULL;

  IF v_first_null_date IS NULL THEN
    -- Nada para backfillear
    updated_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2. Buscar el último balance conocido ANTES de v_first_null_date
  SELECT balance INTO v_seed
  FROM public.transactions
  WHERE user_id = p_user_id
    AND deleted_at IS NULL
    AND balance IS NOT NULL
    AND date < v_first_null_date
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  IF v_seed IS NULL THEN
    v_seed := 0;
  END IF;

  -- 3. Calcular running balance via window function y aplicar UPDATE
  WITH ordered AS (
    SELECT
      t.id,
      v_seed + SUM(t.amount) OVER (
        ORDER BY t.date ASC, t.created_at ASC, t.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS new_balance
    FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND t.deleted_at IS NULL
      AND t.balance IS NULL
      AND t.date >= v_first_null_date
  )
  UPDATE public.transactions tx
  SET balance = ordered.new_balance
  FROM ordered
  WHERE tx.id = ordered.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  updated_count := v_count;
  RETURN NEXT;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.backfill_running_balance(uuid) IS
  'Calcula running balance para transactions con balance NULL del usuario indicado, partiendo del último balance conocido (o 0 si no hay). Idempotente.';

GRANT EXECUTE ON FUNCTION public.backfill_running_balance(uuid) TO authenticated;

-- Aplicar el backfill a TODOS los usuarios con transactions sin balance.
-- Solo corre una vez (en la migration); luego los nuevos CSVs ya pueblan
-- balance directo en el insert del edge function.
DO $$
DECLARE
  uid uuid;
  total_updated int := 0;
  user_updated int;
BEGIN
  FOR uid IN
    SELECT DISTINCT user_id
    FROM public.transactions
    WHERE deleted_at IS NULL AND balance IS NULL
  LOOP
    SELECT updated_count INTO user_updated FROM public.backfill_running_balance(uid);
    total_updated := total_updated + COALESCE(user_updated, 0);
    RAISE NOTICE 'Backfill user %: % rows updated', uid, user_updated;
  END LOOP;
  RAISE NOTICE 'Backfill completo: % rows totales actualizados', total_updated;
END $$;
