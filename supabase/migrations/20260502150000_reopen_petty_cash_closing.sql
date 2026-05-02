-- Reabrir cierre de caja menor (admin-only).
--
-- Caso de uso: el dueño cerró octubre pero después olvidó cargar un gasto.
-- Para evitar abusos de usuarios regulares (que podrían reabrir cierres
-- arbitrariamente y reescribir histórico), esta función está restringida
-- a admins via public.is_admin(auth.uid()).
--
-- Acción transaccional:
--   1. Marca todos los movements del cierre como abiertos (closing_id = NULL).
--   2. Borra el registro del cierre.
--
-- El user puede después editar/borrar movimientos y volver a cerrar.

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
  v_movements_count integer;
  v_is_admin boolean := false;
BEGIN
  -- Solo admins pueden reabrir.
  BEGIN
    v_is_admin := public.is_admin(v_caller);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: solo los administradores pueden reabrir cierres';
  END IF;

  -- Validar que el cierre existe y obtener su dueño.
  SELECT user_id INTO v_owner
  FROM public.petty_cash_closings
  WHERE id = p_closing_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Closing not found: %', p_closing_id;
  END IF;

  -- Liberar movimientos del cierre.
  UPDATE public.petty_cash_movements
  SET closing_id = NULL
  WHERE closing_id = p_closing_id;

  GET DIAGNOSTICS v_movements_count = ROW_COUNT;

  -- Borrar el registro del cierre.
  DELETE FROM public.petty_cash_closings WHERE id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'movements_freed', v_movements_count,
    'owner_user_id', v_owner,
    'reopened_by', v_caller
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_petty_cash_closing(uuid) TO authenticated;

COMMENT ON FUNCTION public.reopen_petty_cash_closing(uuid) IS
  'Reabre un cierre de caja menor: libera movimientos (closing_id=NULL) y borra el registro del cierre. Solo admins via is_admin().';

NOTIFY pgrst, 'reload schema';
