-- HOTFIX: doble conteo en PyG modo Gerencial cuando hay movimientos
-- promovidos desde Caja Menor.
--
-- Flujo actual:
--   1. Usuario crea gasto en petty_cash_movements ($100).
--   2. Click "A Gerencial" → promote_petty_cash_to_cash_movement
--      inserta row en cash_movements con nota "[Pasado desde Caja Menor]"
--      y deja el petty_cash original intacto (por deducibilidad fiscal).
--   3. PYGReport en modo Gerencial suma:
--      - petty_cash_movements (siempre) → $100
--      - cash_movements (en gerencial) → $100 del promovido
--      → utilidad operativa - $200 en lugar de - $100.
--
-- Fix: campo petty_cash_movement_id en cash_movements + filtro en PyG.

ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS petty_cash_movement_id uuid
    REFERENCES public.petty_cash_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_movements_petty_cash
  ON public.cash_movements(petty_cash_movement_id)
  WHERE petty_cash_movement_id IS NOT NULL;

COMMENT ON COLUMN public.cash_movements.petty_cash_movement_id IS
  'FK al movimiento original de Caja Menor que generó este row vía promote_petty_cash_to_cash_movement. NULL para movs que se crearon directo en cash_movements (no promovidos). El PyG en modo Gerencial excluye los rows con esta FK seteada para evitar doble conteo (el mov original ya cuenta vía petty_cash_movements).';

-- Backfill: matchear cash_movements existentes con sus petty_cash_movements
-- de origen vía petty_cash_movements.cash_movement_id (esa columna ya existe
-- y apunta al cash_movement creado en la promoción).
UPDATE public.cash_movements cm
SET petty_cash_movement_id = pcm.id
FROM public.petty_cash_movements pcm
WHERE pcm.cash_movement_id = cm.id
  AND cm.petty_cash_movement_id IS NULL;

-- Recrear promote_petty_cash_to_cash_movement para que setee el FK al insertar.
CREATE OR REPLACE FUNCTION public.promote_petty_cash_to_cash_movement(
  p_movement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_movement record;
  v_new_cash_id uuid;
  v_category_name text;
  v_responsible_name text;
  v_description text;
  v_notes text;
BEGIN
  v_caller := auth.uid();
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

  IF v_movement.user_id != public.current_data_owner() AND v_movement.user_id != v_caller THEN
    RAISE EXCEPTION 'No tenés permiso sobre este movimiento';
  END IF;

  IF v_movement.cash_movement_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ya promovido', 'cash_movement_id', v_movement.cash_movement_id);
  END IF;

  IF v_movement.closing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Movimiento está en un cierre — reabrí el cierre primero';
  END IF;

  -- Cargar nombre de categoría
  SELECT name INTO v_category_name
  FROM public.categories
  WHERE id = v_movement.category_id;

  SELECT name INTO v_responsible_name
  FROM public.responsibles
  WHERE id = v_movement.responsible_id AND user_id = v_movement.user_id;

  v_description := COALESCE(v_responsible_name, 'Caja menor');

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
    user_id, date, type, amount, description, category, notes, responsible_id,
    petty_cash_movement_id
  ) VALUES (
    v_movement.user_id,
    v_movement.date,
    'egreso',
    v_movement.amount,
    v_description,
    v_category_name,
    v_notes,
    v_movement.responsible_id,
    v_movement.id  -- nuevo: link al origen para excluir del PyG
  )
  RETURNING id INTO v_new_cash_id;

  UPDATE public.petty_cash_movements
  SET cash_movement_id = v_new_cash_id,
      updated_at = now()
  WHERE id = v_movement.id;

  RETURN jsonb_build_object('ok', true, 'cash_movement_id', v_new_cash_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_petty_cash_to_cash_movement(uuid) TO authenticated;
