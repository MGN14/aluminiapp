-- ============================================================================
-- Importaciones: TRM de causación para calcular diferencia en cambio
-- ============================================================================
-- Cuando se "causa" la deuda en USD (se cierra el pedido / se recibe la
-- mercancía), se fija la TRM de ese día. La diferencia entre esa TRM y la TRM
-- a la que efectivamente se paga cada abono (import_payments.trm) o la TRM de
-- hoy sobre el saldo pendiente es la diferencia en cambio (ganancia/pérdida
-- financiera). Antes solo guardábamos la TRM de cada abono, sin un punto de
-- referencia para medir la variación del dólar.

ALTER TABLE public.imports
  ADD COLUMN IF NOT EXISTS trm_causacion numeric(12, 4) NULL;

COMMENT ON COLUMN public.imports.trm_causacion IS
  'TRM (COP/USD) del día en que se causó la deuda en USD. Punto de referencia para la diferencia en cambio. Si es NULL, se usa la TRM del primer abono como aproximación.';

NOTIFY pgrst, 'reload schema';
