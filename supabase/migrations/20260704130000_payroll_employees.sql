-- Nómina por EMPLEADO. Hasta ahora el módulo era 100% agregado por mes;
-- con esto cada empleado tiene su ficha, sus prestaciones acumuladas
-- (cesantías, intereses, prima, vacaciones) y sus novedades de ley
-- (dotación 3x/año, vacaciones tomadas, incapacidades, pagos de prestaciones).

CREATE TABLE IF NOT EXISTS public.payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  documento text,
  cargo text,
  salario_base numeric(14, 2) NOT NULL,
  fecha_ingreso date NOT NULL,
  fecha_retiro date,
  tipo_contrato text NOT NULL DEFAULT 'indefinido'
    CHECK (tipo_contrato IN ('indefinido', 'fijo', 'obra_labor', 'aprendizaje', 'prestacion_servicios')),
  arl_clase int NOT NULL DEFAULT 3 CHECK (arl_clase BETWEEN 1 AND 5),
  -- Derecho a auxilio de transporte (ley: salario <= 2 SMMLV). Editable por si
  -- el empleado es remoto / no aplica.
  auxilio_transporte boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_employees_user_idx ON public.payroll_employees(user_id, activo);

ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_employees_owner_all" ON public.payroll_employees;
CREATE POLICY "payroll_employees_owner_all"
  ON public.payroll_employees FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Novedades por empleado: las "cosas pequeñas" que exige la ley y nadie lleva.
CREATE TABLE IF NOT EXISTS public.payroll_employee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.payroll_employees(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'dotacion',              -- entrega de uniformes/calzado (3x/año si <= 2 SMMLV)
    'vacaciones',            -- días tomados
    'incapacidad',           -- días de incapacidad
    'licencia',              -- licencia (maternidad/luto/calamidad)
    'prima_pagada',          -- pago de prima (jun/dic)
    'cesantias_consignadas', -- consignación al fondo (feb 14)
    'intereses_pagados',     -- intereses de cesantías (ene 31)
    'aumento_salario',       -- registro histórico de cambio salarial
    'otro'
  )),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  dias int,
  monto numeric(14, 2),
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_employee_events_emp_idx
  ON public.payroll_employee_events(employee_id, fecha DESC);

ALTER TABLE public.payroll_employee_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_employee_events_owner_all" ON public.payroll_employee_events;
CREATE POLICY "payroll_employee_events_owner_all"
  ON public.payroll_employee_events FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Parámetros de ley del año (editables — el decreto cambia cada diciembre)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS smmlv_actual numeric DEFAULT 1623500,
  ADD COLUMN IF NOT EXISTS aux_transporte_actual numeric DEFAULT 200000;

COMMENT ON COLUMN public.profiles.smmlv_actual IS
  'SMMLV vigente (editable en Nómina — verificar decreto anual).';
COMMENT ON COLUMN public.profiles.aux_transporte_actual IS
  'Auxilio de transporte vigente (editable en Nómina — verificar decreto anual).';
