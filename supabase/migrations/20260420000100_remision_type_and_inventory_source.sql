-- Tipo de remisión: venta (default, afecta inventario como salida) o compra (entrada).
ALTER TABLE public.remisiones
  ADD COLUMN IF NOT EXISTS remision_type text NOT NULL DEFAULT 'venta';

ALTER TABLE public.remisiones
  DROP CONSTRAINT IF EXISTS remisiones_type_check;

ALTER TABLE public.remisiones
  ADD CONSTRAINT remisiones_type_check
  CHECK (remision_type IN ('venta','compra'));

-- Trazabilidad del movimiento: de dónde vino (remisión, ajuste manual, factura…)
-- para poder revertirlo limpiamente al borrar la remisión origen.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS source_type text;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS source_id uuid;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_source
  ON public.inventory_movements(source_type, source_id);
