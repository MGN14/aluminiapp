-- Órdenes de producción: consumir inventario (despiece de plantilla) →
-- producir unidades de producto terminado con costo real.
--
-- Flujo: planificada → en_proceso (RPC 'consumir': descuenta materiales del
-- inventario según el despiece congelado) → terminada (RPC 'terminar':
-- suma stock del producto terminado con cost_per_unit = costo/unidad).
-- Los movimientos de stock son ATÓMICOS en el RPC (SECURITY DEFINER, una
-- transacción) — nada de descuentos línea a línea desde el cliente.

CREATE TABLE IF NOT EXISTS public.production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.product_templates(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  ancho_m numeric(6, 3) NOT NULL CHECK (ancho_m > 0),
  alto_m numeric(6, 3) NOT NULL CHECK (alto_m > 0),
  cantidad int NOT NULL CHECK (cantidad > 0),
  estado text NOT NULL DEFAULT 'planificada'
    CHECK (estado IN ('planificada', 'en_proceso', 'terminada', 'cancelada')),
  -- Despiece congelado al crear la orden (por el TOTAL de unidades):
  -- [{reference, descripcion, qty, unidad, costo_unit, costo_linea}]
  despiece jsonb NOT NULL DEFAULT '[]'::jsonb,
  costo_materiales numeric(14, 2) NOT NULL DEFAULT 0,
  costo_mano_obra numeric(14, 2) NOT NULL DEFAULT 0,
  costo_total numeric(14, 2) GENERATED ALWAYS AS (costo_materiales + costo_mano_obra) STORED,
  -- Referencia del producto terminado en inventario (se crea/incrementa al terminar)
  producto_ref text NOT NULL,
  consumo_aplicado boolean NOT NULL DEFAULT false,
  produccion_aplicada boolean NOT NULL DEFAULT false,
  fecha_inicio date,
  fecha_fin date,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_orders_user_idx
  ON public.production_orders(user_id, estado, created_at DESC);

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "production_orders_owner_all" ON public.production_orders;
CREATE POLICY "production_orders_owner_all"
  ON public.production_orders FOR ALL TO authenticated
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

-- ── RPC atómico: consumir materiales / terminar producción ──────────────────
CREATE OR REPLACE FUNCTION public.apply_production_order(
  p_order_id uuid,
  p_action text -- 'consumir' | 'terminar' | 'cancelar'
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
  v_updated int;
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
      UPDATE public.inventory_products
      SET stock_system = COALESCE(stock_system, 0) - v_qty
      WHERE user_id = v_order.user_id AND lower(trim(reference)) = lower(trim(v_ref));
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN v_faltantes := array_append(v_faltantes, v_ref); END IF;
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
      THEN (v_order.costo_materiales + v_order.costo_mano_obra) / v_order.cantidad ELSE 0 END;

    -- Upsert del producto terminado en inventario: suma stock y actualiza costo
    UPDATE public.inventory_products
    SET stock_system = COALESCE(stock_system, 0) + v_order.cantidad,
        cost_per_unit = v_unit_cost
    WHERE user_id = v_order.user_id
      AND lower(trim(reference)) = lower(trim(v_order.producto_ref));
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      INSERT INTO public.inventory_products (user_id, reference, name, stock_system, cost_per_unit, active)
      VALUES (v_order.user_id, v_order.producto_ref, v_order.template_name, v_order.cantidad, v_unit_cost, true);
    END IF;

    UPDATE public.production_orders
    SET produccion_aplicada = true, estado = 'terminada',
        fecha_fin = CURRENT_DATE, updated_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('ok', true, 'accion', 'terminar', 'costo_unitario', v_unit_cost);

  ELSIF p_action = 'cancelar' THEN
    IF v_order.estado = 'terminada' THEN RAISE EXCEPTION 'No se cancela una orden terminada'; END IF;
    -- Si ya consumió materiales, los devuelve al inventario
    IF v_order.consumo_aplicado THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.despiece) LOOP
        v_ref := v_line->>'reference';
        v_qty := COALESCE((v_line->>'qty')::numeric, 0);
        IF v_ref IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        UPDATE public.inventory_products
        SET stock_system = COALESCE(stock_system, 0) + v_qty
        WHERE user_id = v_order.user_id AND lower(trim(reference)) = lower(trim(v_ref));
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

GRANT EXECUTE ON FUNCTION public.apply_production_order(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.apply_production_order(uuid, text) IS
  'Transiciones atómicas de una orden de producción: consumir (descuenta materiales del despiece), terminar (suma producto terminado con costo real), cancelar (devuelve materiales si se habían consumido).';
