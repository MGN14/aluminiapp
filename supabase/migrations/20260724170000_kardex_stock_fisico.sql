-- La entrada de contenedor debe acreditar TAMBIÉN el stock físico.
--
-- Bug de raíz (reportado por Nico 2026-07-24: "en cobertura el stock físico
-- no los sumó ... y los faltantes empeoraron"):
--   · las remisiones descuentan stock_physical (apply_stock_delta),
--   · kardex_movimiento solo movía stock_system,
--   · la cobertura / reorden leen stock_physical.
-- Resultado: el físico solo podía BAJAR — ninguna importación lo subía — y
-- la cobertura veía 0 en casi todo, disparando faltantes y huecos falsos.
--
-- Fix: p_afecta_fisico (default false, no cambia el resto de callers). La
-- entrada del contenedor y su reversa lo pasan en true: la mercancía llegó
-- físicamente a bodega, no solo a los libros.

DROP FUNCTION IF EXISTS public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text);

CREATE OR REPLACE FUNCTION public.kardex_movimiento(
  p_reference text,
  p_tipo text,               -- entrada_* | salida_* (ver subtipo)
  p_cantidad numeric,
  p_costo_unitario numeric DEFAULT NULL, -- requerido en entradas
  p_origen_tipo text DEFAULT 'manual',
  p_origen_id uuid DEFAULT NULL,
  p_notas text DEFAULT NULL,
  p_afecta_fisico boolean DEFAULT false  -- true = mover también stock_physical
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := public.current_data_owner();
  v_prod record;
  v_es_entrada boolean := p_tipo LIKE 'entrada%';
  v_stock_nuevo numeric;
  v_costo_nuevo numeric;
  v_costo_mov numeric;
  v_fisico_nuevo numeric;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser > 0'; END IF;
  IF p_tipo NOT IN ('entrada_importacion','entrada_produccion','entrada_ajuste',
                    'salida_produccion','salida_despacho','salida_ajuste') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_tipo;
  END IF;
  IF v_es_entrada AND (p_costo_unitario IS NULL OR p_costo_unitario < 0) THEN
    RAISE EXCEPTION 'Las entradas requieren costo unitario';
  END IF;

  SELECT id, stock_system, stock_physical, cost_per_unit INTO v_prod
  FROM public.inventory_products
  WHERE user_id = v_owner AND lower(trim(reference)) = lower(trim(p_reference))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referencia % no existe en inventario', p_reference;
  END IF;

  IF v_es_entrada THEN
    v_stock_nuevo := COALESCE(v_prod.stock_system, 0) + p_cantidad;
    -- Promedio ponderado; si el stock previo era <= 0 o sin costo, manda el
    -- costo de entrada (no se promedia contra stock negativo/fantasma).
    IF COALESCE(v_prod.stock_system, 0) <= 0 OR COALESCE(v_prod.cost_per_unit, 0) <= 0 THEN
      v_costo_nuevo := p_costo_unitario;
    ELSE
      v_costo_nuevo := round(
        (v_prod.stock_system * v_prod.cost_per_unit + p_cantidad * p_costo_unitario)
        / (v_prod.stock_system + p_cantidad), 2);
    END IF;
    v_costo_mov := p_costo_unitario;
    v_fisico_nuevo := COALESCE(v_prod.stock_physical, 0) + p_cantidad;
  ELSE
    v_stock_nuevo := COALESCE(v_prod.stock_system, 0) - p_cantidad;
    v_costo_nuevo := v_prod.cost_per_unit; -- salidas no cambian el promedio
    v_costo_mov := COALESCE(v_prod.cost_per_unit, 0);
    v_fisico_nuevo := COALESCE(v_prod.stock_physical, 0) - p_cantidad;
  END IF;

  UPDATE public.inventory_products
  SET stock_system = v_stock_nuevo,
      cost_per_unit = v_costo_nuevo,
      stock_physical = CASE WHEN p_afecta_fisico THEN v_fisico_nuevo ELSE stock_physical END
  WHERE id = v_prod.id;

  INSERT INTO public.inventory_movements
    (user_id, product_id, movement_type, quantity, unit_cost, total_cost,
     movement_date, notes, subtipo, stock_resultante, costo_promedio_resultante,
     origen_tipo, origen_id)
  VALUES
    (v_owner, v_prod.id, CASE WHEN v_es_entrada THEN 'entrada' ELSE 'salida' END,
     p_cantidad, round(COALESCE(v_costo_mov, 0), 2), round(COALESCE(v_costo_mov, 0) * p_cantidad, 2),
     CURRENT_DATE, p_notas, p_tipo, v_stock_nuevo, v_costo_nuevo,
     p_origen_tipo, p_origen_id);

  RETURN jsonb_build_object('ok', true, 'stock', v_stock_nuevo,
                            'costo_promedio', v_costo_nuevo,
                            'stock_fisico', CASE WHEN p_afecta_fisico THEN v_fisico_nuevo ELSE v_prod.stock_physical END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text, boolean) IS
  'Kardex sobre inventory_movements: entradas promedian el costo (ponderado), salidas descargan al promedio vigente. p_afecta_fisico=true mueve también stock_physical (entradas de contenedor: la mercancía llegó a bodega). Atómico (FOR UPDATE sobre el producto).';

-- ── Backfill: contenedores YA entrados que nunca acreditaron el físico ───────
-- Neto por producto de los movimientos con origen 'import' (entradas − salidas
-- de ajuste). Se suma al stock_physical una sola vez.
WITH neto AS (
  SELECT
    m.user_id,
    m.product_id,
    SUM(CASE WHEN m.movement_type = 'entrada' THEN m.quantity ELSE -m.quantity END) AS delta
  FROM public.inventory_movements m
  WHERE m.origen_tipo = 'import'
  GROUP BY m.user_id, m.product_id
  HAVING SUM(CASE WHEN m.movement_type = 'entrada' THEN m.quantity ELSE -m.quantity END) > 0
)
UPDATE public.inventory_products p
SET stock_physical = COALESCE(p.stock_physical, 0) + n.delta
FROM neto n
WHERE p.id = n.product_id AND p.user_id = n.user_id;

NOTIFY pgrst, 'reload schema';
