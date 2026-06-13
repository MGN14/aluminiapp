-- ============================================================================
-- Módulo Activos Fijos + depreciación lineal
-- ============================================================================
-- Maquinaria, vehículos, equipo, etc. con su costo, fecha y vida útil. La app
-- calcula la depreciación lineal y el valor en libros, que alimentan el rubro
-- "Activos fijos" del Balance General (antes era 0). La depreciación NO se
-- postea al PYG automáticamente (queda como dato para el contador).

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  categoria text NOT NULL DEFAULT 'otro'
    CHECK (categoria IN ('edificaciones', 'maquinaria', 'vehiculos', 'equipo_computo', 'muebles', 'otro')),
  valor_compra numeric(16, 2) NOT NULL DEFAULT 0 CHECK (valor_compra >= 0),
  fecha_compra date NOT NULL,
  vida_util_meses int NOT NULL DEFAULT 120 CHECK (vida_util_meses > 0),
  valor_residual numeric(16, 2) NOT NULL DEFAULT 0 CHECK (valor_residual >= 0),
  metodo text NOT NULL DEFAULT 'linea_recta' CHECK (metodo IN ('linea_recta')),
  -- 'activo' en uso; al darlo de baja (venta/retiro) se marca inactivo y deja
  -- de sumar al balance. (boolean, no confundir con la columna del PUC.)
  activo boolean NOT NULL DEFAULT true,
  notas text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fixed_assets_user_idx ON public.fixed_assets(user_id);

COMMENT ON TABLE public.fixed_assets IS
  'Activos fijos (PP&E) con depreciación lineal. El valor en libros alimenta el Balance General.';

-- Tabla "categoría A": visibilidad por current_data_owner + trigger.
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fixed_assets_owner_data" ON public.fixed_assets;
CREATE POLICY "fixed_assets_owner_data"
  ON public.fixed_assets FOR ALL
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_fixed_assets_user_id ON public.fixed_assets;
CREATE TRIGGER set_fixed_assets_user_id
  BEFORE INSERT ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

DROP TRIGGER IF EXISTS set_fixed_assets_updated_at ON public.fixed_assets;
CREATE TRIGGER set_fixed_assets_updated_at
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
