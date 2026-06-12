-- ============================================================================
-- MÓDULO NÓMINA — registro mensual + provisión de prestaciones sociales
-- ============================================================================
-- Una fila por (user, año, mes) con el devengado del mes y los totales
-- calculados de provisión (cesantías, intereses, prima, vacaciones),
-- seguridad social patronal y parafiscales. Las tasas usadas se guardan en
-- `rates` (jsonb) para auditabilidad — si la ley cambia, las filas viejas
-- conservan las tasas con las que se calcularon.
--
-- La conexión con el cronograma DIAN del dashboard NO vive acá: el frontend
-- upsertea filas en `business_obligations` (tipos nomina/pila/cesantias)
-- marcadas con notas='[auto:nomina]', y UpcomingObligationsCard las muestra.

CREATE TABLE IF NOT EXISTS public.payroll_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year int NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- Devengado del mes: salarios + horas extra + comisiones (sin aux transporte)
  salary_total numeric NOT NULL DEFAULT 0 CHECK (salary_total >= 0),
  -- Auxilio de transporte total del mes (base de prestaciones, NO de seg. social)
  transport_allowance numeric NOT NULL DEFAULT 0 CHECK (transport_allowance >= 0),
  employees_count int,
  -- Tasas aplicadas (%) + flag exoneración Art 114-1 ET. Editables en UI.
  rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Totales calculados al guardar (el frontend es la fuente del cálculo)
  provision_prestaciones numeric NOT NULL DEFAULT 0,
  seguridad_social numeric NOT NULL DEFAULT 0,
  parafiscales numeric NOT NULL DEFAULT 0,
  total_costo_laboral numeric NOT NULL DEFAULT 0,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year, month)
);

ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que las tablas "categoría A" (datos de empresa compartidos
-- con colaboradores): visibilidad por current_data_owner() + trigger que
-- reescribe user_id en INSERT. Ver 20260507120000_collaborators_share_owner_data.
DROP POLICY IF EXISTS "payroll_owner_data" ON public.payroll_entries;
CREATE POLICY "payroll_owner_data"
  ON public.payroll_entries FOR ALL
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_payroll_entries_user_id ON public.payroll_entries;
CREATE TRIGGER set_payroll_entries_user_id
  BEFORE INSERT ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

DROP TRIGGER IF EXISTS set_payroll_entries_updated_at ON public.payroll_entries;
CREATE TRIGGER set_payroll_entries_updated_at
  BEFORE UPDATE ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_payroll_entries_user_period
  ON public.payroll_entries(user_id, year DESC, month DESC);

NOTIFY pgrst, 'reload schema';
