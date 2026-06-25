-- Ubicación física en bodega por referencia (ej: A1, B4, E1).
--
-- Se hornea en el QR de la etiqueta junto a la cantidad
-- ("ALU|<referencia>|<cantidad>|<ubicación>", ver src/lib/qrLabel.ts) y se
-- imprime visible en la etiqueta. Sirve para ubicar/encontrar la referencia al
-- escanear, despachar y contar.
ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN public.inventory_products.location IS
  'Ubicación física en bodega (ej: A1, B4). Se incluye en el QR de la etiqueta y se imprime en ella.';

NOTIFY pgrst, 'reload schema';
