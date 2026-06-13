-- ============================================================================
-- Importaciones Fase 3: costeo referencia a referencia (landed cost)
-- ============================================================================
-- Cada importación pasa de tener UN solo monto/cantidad a tener un desglose
-- por referencia (packing list) + costos adicionales del pedido (flete,
-- arancel, seguro, nacionalización, gastos bancarios). El landed cost por
-- referencia se calcula prorrateando esos costos sobre cada ítem según una
-- base configurable (peso o valor FOB) y convirtiendo USD→COP a la TRM
-- ponderada de los abonos del pedido.
--
-- NO toca inventory_products: el costeo vive dentro del módulo Importaciones
-- (análisis + histórico). El cálculo se hace en el cliente (lib/landedCost.ts)
-- para soportar el prorrateo híbrido por línea de costo.

-- ── Ítems del packing list ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  reference text NOT NULL,                  -- match con inventory_products.reference
  descripcion text NULL,
  cantidad numeric(14, 3) NOT NULL DEFAULT 0,   -- unidades / piezas / bultos
  unidad text NOT NULL DEFAULT 'kg',            -- kg | unidad | m | ...
  peso_kg numeric(14, 3) NULL,                  -- peso neto (base de prorrateo por peso)
  fob_total_usd numeric(16, 2) NOT NULL DEFAULT 0,  -- valor FOB de la línea (base por valor)
  orden int NOT NULL DEFAULT 0,
  notas text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_items_import_idx ON public.import_items(import_id, orden);
CREATE INDEX IF NOT EXISTS import_items_user_ref_idx ON public.import_items(user_id, reference);

COMMENT ON TABLE public.import_items IS
  'Ítems del packing list de una importación, referencia a referencia. Base del landed cost.';

-- ── Costos adicionales del pedido ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'otro'
    CHECK (tipo IN ('flete', 'seguro', 'arancel', 'iva_importacion', 'nacionalizacion', 'gastos_bancarios', 'otro')),
  concepto text NULL,                       -- descripción libre opcional
  monto numeric(16, 2) NOT NULL DEFAULT 0,
  moneda text NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'COP')),
  trm numeric(12, 4) NULL,                  -- si moneda='USD', TRM para convertir (null = usar TRM ponderada del pedido)
  -- Base de prorrateo: cómo se reparte este costo entre las referencias.
  base_asignacion text NOT NULL DEFAULT 'peso'
    CHECK (base_asignacion IN ('peso', 'valor', 'cantidad')),
  orden int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_costs_import_idx ON public.import_costs(import_id, orden);
-- Simetría con import_items_user_ref_idx: el histórico lee import_costs por
-- user_id (vía RLS) sin filtro de import → evitar seq scan al crecer.
CREATE INDEX IF NOT EXISTS import_costs_user_idx ON public.import_costs(user_id);

COMMENT ON TABLE public.import_costs IS
  'Costos adicionales de una importación (flete, arancel, seguro, nacionalización). Se prorratean al landed cost por referencia según base_asignacion.';

-- ── RLS: owner-only, mismo patrón que imports / import_payments ──────────
ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_costs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_items', 'import_costs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_owner_select" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_owner_select" ON public.%I FOR SELECT USING (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_owner_insert" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_owner_insert" ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_owner_update" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_owner_update" ON public.%I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_owner_delete" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_owner_delete" ON public.%I FOR DELETE USING (auth.uid() = user_id)', t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS set_import_items_updated_at ON public.import_items;
CREATE TRIGGER set_import_items_updated_at
  BEFORE UPDATE ON public.import_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_import_costs_updated_at ON public.import_costs;
CREATE TRIGGER set_import_costs_updated_at
  BEFORE UPDATE ON public.import_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
