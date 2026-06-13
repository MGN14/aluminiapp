-- ============================================================================
-- Presupuesto vs Real: metas mensuales por grupo del Estado de Resultados
-- ============================================================================
-- Una fila por (user, año, mes, report_group). El "real" NO se guarda: se
-- calcula on-the-fly desde transactions/petty (misma lógica que el PYG).
-- report_group usa los mismos valores que categories.report_group:
--   ingresos | costos_operacionales | gastos_operativos | impuestos | otros

CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year int NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  report_group text NOT NULL
    CHECK (report_group IN ('ingresos', 'costos_operacionales', 'gastos_operativos', 'impuestos', 'otros')),
  amount_planned numeric(16, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year, month, report_group)
);

CREATE INDEX IF NOT EXISTS budgets_user_year_idx ON public.budgets(user_id, year);

COMMENT ON TABLE public.budgets IS
  'Presupuesto mensual por grupo del Estado de Resultados. El real se calcula aparte y se cruza para el desvío.';

-- RLS: tabla "categoría A" (datos de empresa compartidos con colaboradores).
-- Visibilidad por current_data_owner() + trigger que reescribe user_id en INSERT.
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budgets_owner_data" ON public.budgets;
CREATE POLICY "budgets_owner_data"
  ON public.budgets FOR ALL
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_budgets_user_id ON public.budgets;
CREATE TRIGGER set_budgets_user_id
  BEFORE INSERT ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

DROP TRIGGER IF EXISTS set_budgets_updated_at ON public.budgets;
CREATE TRIGGER set_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
