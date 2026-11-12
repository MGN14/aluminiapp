-- ============================================================================
-- Medida de paquete y peso por referencia (Referencias por variante).
-- ============================================================================
-- El cargue cuenta PAQUETES y planea el camión por PESO. Hasta ahora esos
-- datos salían solo de los packing lists de Importaciones (cantidad ÷ bultos,
-- peso ÷ cantidad) o se ponían a mano en cada remisión. Desde ahora viven en
-- la lista oficial de referencias por color: se suben en el mismo Excel, se
-- editan en la tabla o se aprenden desde el plan de cargue.
--
-- Aditiva: dos columnas opcionales. No toca stock, costos ni movimientos.
-- ============================================================================

ALTER TABLE public.inventory_variants
  ADD COLUMN IF NOT EXISTS unidades_por_paquete numeric,
  ADD COLUMN IF NOT EXISTS kg_por_unidad numeric;

ALTER TABLE public.inventory_variants DROP CONSTRAINT IF EXISTS inventory_variants_unidades_por_paquete_pos;
ALTER TABLE public.inventory_variants
  ADD CONSTRAINT inventory_variants_unidades_por_paquete_pos CHECK (unidades_por_paquete IS NULL OR unidades_por_paquete > 0);

ALTER TABLE public.inventory_variants DROP CONSTRAINT IF EXISTS inventory_variants_kg_por_unidad_pos;
ALTER TABLE public.inventory_variants
  ADD CONSTRAINT inventory_variants_kg_por_unidad_pos CHECK (kg_por_unidad IS NULL OR kg_por_unidad > 0);

COMMENT ON COLUMN public.inventory_variants.unidades_por_paquete IS 'Piezas que trae un paquete estándar de esta referencia (el último del pedido puede venir incompleto).';
COMMENT ON COLUMN public.inventory_variants.kg_por_unidad IS 'Peso de una pieza en kg (para planear el cargue del camión).';

NOTIFY pgrst, 'reload schema';
