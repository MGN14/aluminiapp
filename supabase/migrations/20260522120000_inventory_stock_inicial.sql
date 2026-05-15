-- Inventario teórico (modo Gerencial).
--
-- stock_inicial es el punto de ancla desde el cual se calcula "lo que debería
-- haber en bodega" sin importar factura/Siigo:
--
--   teórico = stock_inicial
--           + Σ entradas manuales (inventory_movements source_type='entrada_manual')
--           − Σ remisiones de venta (inventory_movements source_type='remision', salida)
--
-- contando solo movimientos con movement_date >= stock_inicial_date.
--
-- El "cuadre global" re-ancla todo el inventario: stock_inicial pasa a ser el
-- stock físico contado y stock_inicial_date se actualiza a hoy ("el final se
-- vuelve inicial"). A partir de ahí el teórico arranca de cero otra vez.
ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS stock_inicial NUMERIC,
  ADD COLUMN IF NOT EXISTS stock_inicial_date TIMESTAMPTZ;

-- Cuadre global: re-ancla el teórico de todas las referencias activas que ya
-- tienen un conteo físico. SECURITY INVOKER + RLS → solo toca las filas del
-- usuario que la invoca. Devuelve cuántas referencias se cuadraron.
CREATE OR REPLACE FUNCTION public.cuadrar_inventario_teorico()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.inventory_products
  SET stock_inicial = stock_physical,
      stock_inicial_date = now()
  WHERE active = true
    AND stock_physical IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cuadrar_inventario_teorico() TO authenticated;
