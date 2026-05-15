-- Módulo Importaciones: pedidos de aluminio a proveedores del exterior
-- (Shandong, JH, etc.). No están en DIAN porque son proveedores extranjeros
-- — se trackean manualmente con su propio flujo de estados.
--
-- Flujo de estados:
--   cotizacion → anticipo → produccion → transito → aduana → entregado
--
-- precio_smm_cerrado_usd_ton: cuando Nico paga el anticipo se "cierra" el
-- precio SMM (LME spread + premium) acordado con el proveedor. Después de
-- eso fluctuaciones del LME ya no afectan ese pedido.

CREATE TABLE IF NOT EXISTS public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsible_id uuid NULL REFERENCES public.responsibles(id) ON DELETE SET NULL,
  proveedor_nombre text NOT NULL, -- denormalizado: nombre del proveedor (más flexible que solo FK)
  estado text NOT NULL DEFAULT 'cotizacion'
    CHECK (estado IN ('cotizacion', 'anticipo', 'produccion', 'transito', 'aduana', 'entregado', 'cancelado')),
  cantidad_ton numeric(10, 3) NULL,
  precio_smm_cerrado_usd_ton numeric(10, 2) NULL, -- USD/ton, queda fijo desde anticipo
  monto_total_usd numeric(14, 2) NULL,
  anticipo_pagado_usd numeric(14, 2) NOT NULL DEFAULT 0,
  -- saldo_pendiente_usd se computa: monto_total_usd − anticipo_pagado_usd
  -- (lo dejo como columna calculada para que sea barato leer desde el endpoint)
  saldo_pendiente_usd numeric(14, 2) GENERATED ALWAYS AS (
    COALESCE(monto_total_usd, 0) - COALESCE(anticipo_pagado_usd, 0)
  ) STORED,
  fecha_cotizacion date NULL,
  fecha_anticipo date NULL,
  fecha_embarque date NULL,
  fecha_estimada_llegada date NULL,
  fecha_arribo_real date NULL,
  ref_pedido text NULL, -- número de referencia/PO interna
  notas text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS imports_user_estado_idx
  ON public.imports(user_id, estado);
CREATE INDEX IF NOT EXISTS imports_user_eta_idx
  ON public.imports(user_id, fecha_estimada_llegada)
  WHERE estado NOT IN ('entregado', 'cancelado');
CREATE INDEX IF NOT EXISTS imports_responsible_idx
  ON public.imports(user_id, responsible_id)
  WHERE responsible_id IS NOT NULL;

COMMENT ON TABLE public.imports IS
  'Pedidos de importación a proveedores extranjeros (no DIAN). Flujo: cotización → anticipo → producción → tránsito → aduana → entregado.';

-- =============================================================================
-- RLS — owner-only (mismo patrón que expected_payments / operative_receivables)
-- =============================================================================
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "imports_owner_select" ON public.imports;
CREATE POLICY "imports_owner_select"
  ON public.imports FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "imports_owner_insert" ON public.imports;
CREATE POLICY "imports_owner_insert"
  ON public.imports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "imports_owner_update" ON public.imports;
CREATE POLICY "imports_owner_update"
  ON public.imports FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "imports_owner_delete" ON public.imports;
CREATE POLICY "imports_owner_delete"
  ON public.imports FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger updated_at
DROP TRIGGER IF EXISTS set_imports_updated_at ON public.imports;
CREATE TRIGGER set_imports_updated_at
  BEFORE UPDATE ON public.imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
