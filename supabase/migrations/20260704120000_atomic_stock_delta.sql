-- ============================================================================
-- Descuento ATÓMICO de stock físico (anti carrera multi-operario).
-- ============================================================================
-- El flujo de despacho descontaba stock con read-modify-write desde el cliente
-- (leer stock_physical → sumar delta → update con el valor absoluto). Con dos
-- tablets despachando a la vez, la segunda escritura pisaba a la primera y se
-- perdía un descuento (lost update).
--
-- Este RPC hace el ajuste EN el UPDATE (stock = stock + delta), que Postgres
-- serializa a nivel de fila → dos despachos simultáneos suman/restan bien.
-- SECURITY DEFINER con el mismo patrón que allocate_label_seq: scoped al
-- current_data_owner(), así los colaboradores ajustan el inventario del owner
-- y nadie puede tocar productos ajenos.
--
-- El frontend lo usa con fallback: si el RPC no existe todavía (migración sin
-- aplicar), cae al método viejo. Aplicar con: supabase db push
-- ============================================================================

DROP FUNCTION IF EXISTS public.apply_stock_delta(uuid, numeric);
CREATE OR REPLACE FUNCTION public.apply_stock_delta(p_product_id uuid, p_delta numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_new numeric;
BEGIN
  v_owner := public.current_data_owner();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin owner para ajustar stock'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RAISE EXCEPTION 'delta inválido'; END IF;

  UPDATE public.inventory_products
     SET stock_physical = COALESCE(stock_physical, 0) + p_delta
   WHERE id = p_product_id AND user_id = v_owner
  RETURNING stock_physical INTO v_new;

  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado para este owner'; END IF;
  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION public.apply_stock_delta(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
