-- Sistema de etiquetas QR + verificación de despacho por escaneo.
--
-- Flujo físico:
--   1) En RECEPCIÓN se imprime una etiqueta QR por PAQUETE. El QR lleva la
--      referencia Y la cantidad de unidades del paquete horneadas dentro, con
--      el formato "ALU|<referencia>|<cantidad>" (ver src/lib/qrLabel.ts).
--   2) En la ESTACIÓN DE DESPACHO, Yolanda escanea cada paquete con la pistola
--      Bluetooth (HID) y la app suma la cantidad del QR a la línea de la
--      remisión hasta que cuadra. El mismo escaneo alimenta el conteo físico.
--
-- La cantidad va en el QR (no un default fijo por referencia) porque los
-- paquetes a veces traen cantidades distintas: el operario la fija al imprimir
-- en el momento tranquilo (recepción), y el despacho queda 100% automático.

-- Cantidad por paquete "estándar": solo pre-llena el campo al imprimir la
-- etiqueta. Es editable por etiqueta; este valor queda como sugerencia para la
-- próxima impresión de esa referencia. NO se usa en ningún cálculo de stock.
ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS units_per_package NUMERIC;

COMMENT ON COLUMN public.inventory_products.units_per_package IS
  'Cantidad estándar de unidades por paquete. Solo pre-llena la impresión de etiquetas QR; editable por etiqueta. No afecta el stock.';

-- Verificación de despacho: cuándo / quién confirmó físicamente la remisión
-- escaneando los paquetes, y cuántas unidades se confirmaron al escanear
-- (para auditar contra las unidades esperadas de la remisión).
ALTER TABLE public.remisiones
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID,
  ADD COLUMN IF NOT EXISTS verified_units NUMERIC;

COMMENT ON COLUMN public.remisiones.verified_at IS
  'Momento en que la remisión se verificó físicamente escaneando los paquetes en la estación de despacho.';

NOTIFY pgrst, 'reload schema';
