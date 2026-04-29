-- Informe para Banco — campos cualitativos del negocio
-- Para responder preguntas como "como es la logistica?", "cuantos
-- empleados tenes?", etc. Editables desde Settings, mostrados en el
-- informe + PDF.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_description text,
  ADD COLUMN IF NOT EXISTS business_warehouse_location text,
  ADD COLUMN IF NOT EXISTS business_employees_count integer,
  ADD COLUMN IF NOT EXISTS business_operation_days text,
  ADD COLUMN IF NOT EXISTS business_logistics text,
  ADD COLUMN IF NOT EXISTS business_main_suppliers text;

COMMENT ON COLUMN public.profiles.business_description IS 'Descripcion breve del negocio (1-2 parrafos): que vende, a quien, modelo.';
COMMENT ON COLUMN public.profiles.business_warehouse_location IS 'Direccion de bodega/punto operacion principal (puede ser distinta de company_address).';
COMMENT ON COLUMN public.profiles.business_employees_count IS 'Numero de empleados directos.';
COMMENT ON COLUMN public.profiles.business_operation_days IS 'Dias y horario de operacion (ej. "Lunes a Viernes 8am-6pm, Sabado 8am-12pm").';
COMMENT ON COLUMN public.profiles.business_logistics IS 'Como funciona la logistica del negocio: transporte, distribucion, entrega.';
COMMENT ON COLUMN public.profiles.business_main_suppliers IS 'Principales proveedores (texto libre).';
