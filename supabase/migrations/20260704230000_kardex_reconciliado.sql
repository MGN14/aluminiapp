-- KARDEX reconciliado sobre la tabla inventory_movements EXISTENTE.
--
-- La versión original de esta migración (20260704200000_kardex) creaba una
-- tabla inventory_movements nueva, pero esa tabla ya existe en producción
-- desde 20260408164259 (movement_type/quantity/unit_cost/total_cost/
-- movement_date + source_type/source_id) con datos reales de remisiones,
-- entradas manuales y siigo-sync. En vez de duplicar el ledger, el kardex
-- EVOLUCIONA esa tabla: columnas aditivas para la foto clásica de kardex
-- (tipo granular, stock y costo promedio resultantes) y un único punto de
-- escritura (RPC kardex_movimiento) que llena esquema viejo + nuevo en la
-- misma fila:
--   movement_type  ← 'entrada' | 'salida' (derivado de tipo)
--   quantity/unit_cost/total_cost/movement_date ← equivalentes kardex
--   source_type/source_id ← origen ('import' | 'production_order' | 'manual')
--   tipo/reference/stock_resultante/costo_promedio_resultante ← kardex nuevo
--
-- Así los flujos viejos (remisiones, entrada manual, teórico gerencial que
-- filtra source_type IN ('entrada_manual','remision'), stock inicial) siguen
-- intactos, y las entradas kardex aparecen en el historial de inventario
-- existente sin tocar el frontend.
--
-- Costo promedio ponderado (método fiscal estándar para PyMEs colombianas):
--   nuevo_costo = (stock_actual × costo_actual + qty × costo_entrada) / (stock_actual + qty)
-- Las salidas descargan al promedio vigente sin cambiarlo.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS stock_resultante numeric,
  ADD COLUMN IF NOT EXISTS costo_promedio_resultante numeric;

COMMENT ON COLUMN public.inventory_movements.tipo IS
  'Tipo granular de kardex (entrada_importacion, salida_produccion, …). NULL en filas legacy (remisiones, entradas manuales, siigo).';
COMMENT ON COLUMN public.inventory_movements.stock_resultante IS
  'Foto del stock_system DESPUÉS del movimiento — kardex clásico. Solo la escribe kardex_movimiento().';
COMMENT ON COLUMN public.inventory_movements.costo_promedio_resultante IS
  'Costo promedio ponderado DESPUÉS del movimiento. Solo la escribe kardex_movimiento().';

-- Parcial: las filas legacy no tienen reference (llegan por product_id).
CREATE INDEX IF NOT EXISTS inventory_movements_ref_idx
  ON public.inventory_movements(user_id, lower(reference), created_at DESC)
  WHERE reference IS NOT NULL;

-- RLS: la tabla ya tiene las 4 policies owner_or_collab (20260507120000).
-- Las escrituras de kardex entran por el RPC (SECURITY DEFINER) igualmente.

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
  v_costo_mov numeric;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_tipo NOT IN (
    'entrada_importacion', 'entrada_produccion', 'entrada_ajuste',
    'salida_produccion', 'salida_despacho', 'salida_ajuste'
  ) THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_tipo;
  END IF;
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
    v_costo_mov := p_costo_unitario;
  ELSE
    v_stock_nuevo := COALESCE(v_prod.stock_system, 0) - p_cantidad;
    v_costo_nuevo := v_prod.cost_per_unit; -- salidas no cambian el promedio
    v_costo_mov := COALESCE(v_prod.cost_per_unit, 0); -- salida al promedio vigente
  END IF;

  UPDATE public.inventory_products
  SET stock_system = v_stock_nuevo, cost_per_unit = v_costo_nuevo
  WHERE id = v_prod.id;

  INSERT INTO public.inventory_movements
    (user_id, product_id, movement_type, quantity, unit_cost, total_cost,
     movement_date, source_type, source_id, notes,
     reference, tipo, stock_resultante, costo_promedio_resultante)
  VALUES
    (v_owner, v_prod.id,
     CASE WHEN v_es_entrada THEN 'entrada' ELSE 'salida' END,
     p_cantidad, COALESCE(v_costo_mov, 0), round(p_cantidad * COALESCE(v_costo_mov, 0), 2),
     CURRENT_DATE, p_origen_tipo, p_origen_id, p_notas,
     trim(p_reference), p_tipo, v_stock_nuevo, v_costo_nuevo);

  RETURN jsonb_build_object(
    'ok', true, 'stock', v_stock_nuevo, 'costo_promedio', v_costo_nuevo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.kardex_movimiento(text, text, numeric, numeric, text, uuid, text) IS
  'Único punto de escritura del kardex: registra el movimiento en inventory_movements (esquema legacy + columnas kardex) y actualiza stock_system/cost_per_unit con promedio ponderado. Atómico (FOR UPDATE sobre el producto).';

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
  'Ledger unificado de inventario: filas legacy (remisiones, entradas manuales, siigo-sync) + kardex (tipo/stock_resultante/costo_promedio_resultante via kardex_movimiento(), método promedio ponderado).';
