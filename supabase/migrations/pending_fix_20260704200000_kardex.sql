-- KARDEX + costo promedio ponderado automático (gap ERP #2).
--
-- Cada movimiento de inventario queda registrado y las ENTRADAS con costo
-- recalculan el promedio ponderado del producto:
--   nuevo_costo = (stock_actual × costo_actual + qty × costo_entrada) / (stock_actual + qty)
-- Las SALIDAS descargan stock al costo promedio vigente (método promedio,
-- el estándar fiscal colombiano para PyMEs).
--
-- Un solo punto de escritura: el RPC kardex_movimiento (atómico, FOR UPDATE
-- sobre el producto). Los flujos existentes se integran acá:
--   entrada_importacion → botón "Aplicar landed cost" (qty + costo landed)
--   salida_produccion / entrada_produccion → apply_production_order
--   ajuste → correcciones manuales

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.inventory_products(id) ON DELETE SET NULL,
  reference text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN (
    'entrada_importacion', 'entrada_produccion', 'entrada_ajuste',
    'salida_produccion', 'salida_despacho', 'salida_ajuste'
  )),
  cantidad numeric(14, 3) NOT NULL CHECK (cantidad > 0),
  /** Costo unitario del movimiento: en entradas, el costo de ingreso; en
      salidas, el promedio vigente al momento de salir. */
  costo_unitario numeric(14, 2),
  /** Foto DESPUÉS del movimiento — el kardex clásico. */
  stock_resultante numeric(14, 3),
  costo_promedio_resultante numeric(14, 2),
  origen_tipo text,   -- 'import' | 'production_order' | 'manual' | ...
  origen_id uuid,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_ref_idx
  ON public.inventory_movements(user_id, lower(reference), created_at DESC);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_movements_owner_select" ON public.inventory_movements;
CREATE POLICY "inventory_movements_owner_select"
  ON public.inventory_movements FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
-- Solo escribe el RPC (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.kardex_movimiento(
  p_reference text,
  p_tipo text,
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
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser > 0'; END IF;
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
    -- Promedio ponderado: si el stock previo era <= 0 (o sin costo), el costo
    -- nuevo manda (no promediamos contra stock negativo/fantasma).
    IF COALESCE(v_prod.stock_system, 0) <= 0 OR COALESCE(v_prod.cost_per_unit, 0) <= 0 THEN
      v_costo_nuevo := p_costo_unitario;
    ELSE
      v_costo_nuevo := round(
        (v_prod.stock_system * v_prod.cost_per_unit + p_cantidad * p_costo_unitario)
        / (v_prod.stock_system + p_cantidad), 2);
    END IF;
  ELSE
    v_stock_nuevo := COALESCE(v_prod.stock_system, 0) - p_cantidad;
    v_costo_nuevo := v_prod.cost_per_unit; -- salidas no cambian el promedio
  END IF;

  UPDATE public.inventory_products
  SET stock_system = v_stock_nuevo, cost_per_unit = v_costo_nuevo
  WHERE id = v_prod.id;

  INSERT INTO public.inventory_movements
    (user_id, product_id, reference, tipo, cantidad, costo_unitario,
     stock_resultante, costo_promedio_resultante, origen_tipo, origen_id, notas)
  VALUES
    (v_owner, v_prod.id, trim(p_reference), p_tipo, p_cantidad,
     CASE WHEN v_es_entrada THEN p_costo_unitario ELSE v_prod.cost_per_unit END,
     v_stock_nuevo, v_costo_nuevo, p_origen_tipo, p_origen_id, p_notas);

  RETURN jsonb_build_object(
    'ok', true, 'stock', v_stock_nuevo, 'costo_promedio', v_costo_nuevo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text) TO authenticated;

-- ── Integración: producción pasa por el kardex ──────────────────────────────
-- apply_production_order ahora registra movimientos de kardex en vez de tocar
-- stock directo: salidas de materiales al consumir, entrada del producto
-- terminado (con promedio ponderado) al terminar.
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

    -- Crear el producto terminado si no existe, luego entrada por kardex
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

COMMENT ON TABLE public.inventory_movements IS
  'Kardex: cada entrada/salida con costo, stock y promedio resultante. Método promedio ponderado. Escribe solo kardex_movimiento().';
