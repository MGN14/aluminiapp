-- KARDEX + costo promedio ponderado automático (gap ERP #2).
--
-- IMPORTANTE: inventory_movements YA EXISTÍA (migración 20260408 — remisiones/
-- despachos con movement_type entrada/salida). El kardex se INTEGRA a esa
-- tabla en vez de crear otra: así Cobertura y el modelo de demanda (que leen
-- esta tabla) ven automáticamente las salidas de producción y las entradas
-- de contenedor.
--
-- Entradas recalculan el promedio ponderado del producto:
--   nuevo_costo = (stock × costo_actual + qty × costo_entrada) / (stock + qty)
-- Salidas descargan al promedio vigente (método promedio, estándar PyME CO).
-- Un solo punto de escritura atómico: RPC kardex_movimiento.

-- Columnas de kardex sobre la tabla existente
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS subtipo text,
  ADD COLUMN IF NOT EXISTS stock_resultante numeric,
  ADD COLUMN IF NOT EXISTS costo_promedio_resultante numeric,
  ADD COLUMN IF NOT EXISTS origen_tipo text,
  ADD COLUMN IF NOT EXISTS origen_id uuid;

COMMENT ON COLUMN public.inventory_movements.subtipo IS
  'Detalle del movimiento de kardex: entrada_importacion | entrada_produccion | entrada_ajuste | salida_produccion | salida_despacho | salida_ajuste. NULL en filas legacy.';

CREATE INDEX IF NOT EXISTS inventory_movements_kardex_idx
  ON public.inventory_movements(user_id, product_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.kardex_movimiento(
  p_reference text,
  p_tipo text,               -- entrada_* | salida_* (ver subtipo)
  p_cantidad numeric,
  p_costo_unitario numeric DEFAULT NULL, -- requerido en entradas
  p_origen_tipo text DEFAULT 'manual',
  p_origen_id uuid DEFAULT NULL,
  p_notas text DEFAULT NULL
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

  SELECT id, stock_system, cost_per_unit INTO v_prod
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
  ELSE
    v_stock_nuevo := COALESCE(v_prod.stock_system, 0) - p_cantidad;
    v_costo_nuevo := v_prod.cost_per_unit; -- salidas no cambian el promedio
    v_costo_mov := COALESCE(v_prod.cost_per_unit, 0);
  END IF;

  UPDATE public.inventory_products
  SET stock_system = v_stock_nuevo, cost_per_unit = v_costo_nuevo
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

  RETURN jsonb_build_object('ok', true, 'stock', v_stock_nuevo, 'costo_promedio', v_costo_nuevo);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text) TO authenticated;

-- ── Producción pasa por el kardex ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_production_order(
  p_order_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_line jsonb;
  v_ref text;
  v_qty numeric;
  v_faltantes text[] := '{}';
  v_unit_cost numeric;
BEGIN
  SELECT * INTO v_order FROM public.production_orders
  WHERE id = p_order_id AND user_id = public.current_data_owner()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF p_action = 'consumir' THEN
    IF v_order.consumo_aplicado THEN RAISE EXCEPTION 'El consumo ya fue aplicado'; END IF;
    IF v_order.estado NOT IN ('planificada') THEN RAISE EXCEPTION 'Solo se consume una orden planificada'; END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.despiece) LOOP
      v_ref := v_line->>'reference';
      v_qty := COALESCE((v_line->>'qty')::numeric, 0);
      IF v_ref IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
      BEGIN
        PERFORM public.kardex_movimiento(
          v_ref, 'salida_produccion', v_qty, NULL,
          'production_order', p_order_id,
          'Consumo orden ' || v_order.template_name);
      EXCEPTION WHEN OTHERS THEN
        v_faltantes := array_append(v_faltantes, v_ref);
      END;
    END LOOP;

    UPDATE public.production_orders
    SET consumo_aplicado = true, estado = 'en_proceso',
        fecha_inicio = COALESCE(fecha_inicio, CURRENT_DATE), updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'accion', 'consumir', 'refs_no_encontradas', to_jsonb(v_faltantes));

  ELSIF p_action = 'terminar' THEN
    IF v_order.produccion_aplicada THEN RAISE EXCEPTION 'La producción ya fue registrada'; END IF;
    IF v_order.estado <> 'en_proceso' THEN RAISE EXCEPTION 'Solo se termina una orden en proceso'; END IF;

    v_unit_cost := CASE WHEN v_order.cantidad > 0
      THEN round((v_order.costo_materiales + v_order.costo_mano_obra) / v_order.cantidad, 2) ELSE 0 END;

    INSERT INTO public.inventory_products (user_id, reference, name, stock_system, cost_per_unit, active)
    SELECT v_order.user_id, v_order.producto_ref, v_order.template_name, 0, 0, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.inventory_products
      WHERE user_id = v_order.user_id
        AND lower(trim(reference)) = lower(trim(v_order.producto_ref))
    );
    PERFORM public.kardex_movimiento(
      v_order.producto_ref, 'entrada_produccion', v_order.cantidad, v_unit_cost,
      'production_order', p_order_id,
      'Producción ' || v_order.template_name);

    UPDATE public.production_orders
    SET produccion_aplicada = true, estado = 'terminada', fecha_fin = CURRENT_DATE, updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'accion', 'terminar', 'costo_unitario', v_unit_cost);

  ELSIF p_action = 'cancelar' THEN
    IF v_order.estado = 'terminada' THEN RAISE EXCEPTION 'No se cancela una orden terminada'; END IF;
    IF v_order.consumo_aplicado THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.despiece) LOOP
        v_ref := v_line->>'reference';
        v_qty := COALESCE((v_line->>'qty')::numeric, 0);
        IF v_ref IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        BEGIN
          PERFORM public.kardex_movimiento(
            v_ref, 'entrada_ajuste', v_qty, COALESCE((v_line->>'costo_unit')::numeric, 0),
            'production_order', p_order_id, 'Devolución por cancelación');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;
    END IF;
    UPDATE public.production_orders
    SET estado = 'cancelada', consumo_aplicado = false, updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'accion', 'cancelar', 'materiales_devueltos', v_order.consumo_aplicado);
  END IF;

  RAISE EXCEPTION 'Acción inválida: %', p_action;
END;
$$;

COMMENT ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text) IS
  'Kardex sobre inventory_movements: entradas promedian el costo (ponderado), salidas descargan al promedio vigente. Atómico (FOR UPDATE sobre el producto).';
