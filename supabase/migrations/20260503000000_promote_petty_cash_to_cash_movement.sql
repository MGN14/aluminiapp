-- Migration: pasar gastos de Caja Menor a Movimientos en efectivo (Modo Gerencial)
--
-- Idea: el dueño puede "promover" un movimiento de petty_cash_movements a
-- cash_movements para verlo en el flujo consolidado de efectivo del Modo
-- Gerencial. El movimiento original NO se borra: sigue contando para
-- deducibilidad DIAN. Linkeamos por FK para idempotencia (un mismo gasto no
-- se duplica) y para soportar "des-promover" si se borra el cash_movement.

-- 1) Columna FK que apunta al cash_movement reflejo (NULL = aún no promovido).
ALTER TABLE public.petty_cash_movements
  ADD COLUMN IF NOT EXISTS cash_movement_id uuid
    REFERENCES public.cash_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_petty_cash_movements_cash_movement
  ON public.petty_cash_movements(cash_movement_id)
  WHERE cash_movement_id IS NOT NULL;

COMMENT ON COLUMN public.petty_cash_movements.cash_movement_id IS
  'FK opcional a cash_movements. Si NOT NULL, el gasto fue replicado en Movimientos en efectivo (Modo Gerencial). ON DELETE SET NULL permite re-promover si el cash_movement se elimina.';

-- 2) Función transaccional para promover: valida ownership, cierre y duplicado.
DROP FUNCTION IF EXISTS public.promote_petty_cash_to_cash_movement(uuid);

CREATE OR REPLACE FUNCTION public.promote_petty_cash_to_cash_movement(
  p_movement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_movement record;
  v_responsible_name text;
  v_category_name text;
  v_description text;
  v_notes text;
  v_new_cash_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT m.id, m.user_id, m.date, m.amount, m.responsible_id, m.category_id,
         m.concept, m.kind, m.numero_cuenta_cobro, m.notes, m.closing_id,
         m.cash_movement_id
    INTO v_movement
  FROM public.petty_cash_movements m
  WHERE m.id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado';
  END IF;

  IF v_movement.user_id <> v_caller THEN
    RAISE EXCEPTION 'No autorizado: solo el dueño del movimiento puede promoverlo';
  END IF;

  IF v_movement.closing_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede promover un movimiento incluido en un cierre de caja';
  END IF;

  IF v_movement.cash_movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este movimiento ya fue pasado a Movimientos en efectivo';
  END IF;

  SELECT name INTO v_responsible_name
  FROM public.responsibles
  WHERE id = v_movement.responsible_id AND user_id = v_caller;

  SELECT name INTO v_category_name
  FROM public.categories
  WHERE id = v_movement.category_id AND user_id = v_caller;

  -- Descripción para cash_movements (campo legacy del beneficiario)
  v_description := COALESCE(v_responsible_name, 'Caja menor');

  -- Notas combinadas: concepto + cuenta de cobro + notas originales + tag de origen
  v_notes := TRIM(BOTH E'\n' FROM
    CONCAT_WS(E'\n',
      NULLIF(v_movement.concept, ''),
      CASE
        WHEN v_movement.kind = 'cuenta_de_cobro' AND v_movement.numero_cuenta_cobro IS NOT NULL
          THEN 'Cuenta de cobro #' || v_movement.numero_cuenta_cobro
        ELSE NULL
      END,
      NULLIF(v_movement.notes, ''),
      '[Pasado desde Caja Menor]'
    )
  );

  INSERT INTO public.cash_movements (
    user_id, date, type, amount, description, category, notes, responsible_id
  ) VALUES (
    v_movement.user_id,
    v_movement.date,
    'egreso',
    v_movement.amount,
    v_description,
    v_category_name,
    v_notes,
    v_movement.responsible_id
  )
  RETURNING id INTO v_new_cash_id;

  UPDATE public.petty_cash_movements
  SET cash_movement_id = v_new_cash_id,
      updated_at = now()
  WHERE id = p_movement_id;

  RETURN jsonb_build_object(
    'cash_movement_id', v_new_cash_id,
    'petty_cash_movement_id', p_movement_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_petty_cash_to_cash_movement(uuid) TO authenticated;

COMMENT ON FUNCTION public.promote_petty_cash_to_cash_movement(uuid) IS
  'Crea un cash_movement (egreso) reflejo del movimiento de caja menor indicado y vincula vía cash_movement_id. Idempotente. Solo el dueño del movimiento puede ejecutar (auth.uid() = user_id). Bloquea si el movimiento está en un cierre.';
