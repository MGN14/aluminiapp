-- Escenarios → Pedidos: mercancía/peso/unidades corregidos son datos REALES
-- del contenedor, no perillas de juego (Nico 2026-09-03: "cambié la mercancía
-- USD, las unidades y el peso total y no se actualizó 2026-2 en pedidos ni el
-- saldo"). Antes vivían solo en localStorage del tablero.
--
-- · Mercancía USD → se escribe directo en imports.monto_total_usd (es LA
--   factura real; saldo_pendiente_usd es GENERATED y se recalcula solo).
-- · Peso y unidades reales → columnas propias. NO se pisa cantidad_ton (ese
--   es el tonelaje contratado, alimenta la valoración SMM del costeo): el
--   peso real es lo que la fábrica despachó de verdad y prorratea el flete.
--   Orden de mando en el tablero: real (estas columnas) > packing > digitado.

ALTER TABLE public.imports
  ADD COLUMN IF NOT EXISTS peso_real_kg numeric(14, 2) NULL,
  ADD COLUMN IF NOT EXISTS unidades_reales numeric(14, 2) NULL;

COMMENT ON COLUMN public.imports.peso_real_kg IS
  'Peso realmente despachado (kg), corregido a mano desde Escenarios. NULL = usar packing o cantidad_ton. Prorratea flete por peso.';
COMMENT ON COLUMN public.imports.unidades_reales IS
  'Unidades realmente despachadas, corregidas a mano desde Escenarios. NULL = usar packing (o derivar del peso). Prorratea flete por unidad.';

NOTIFY pgrst, 'reload schema';
