
-- Add report_group column to categories
ALTER TABLE public.categories 
ADD COLUMN report_group text NOT NULL DEFAULT 'otros';

-- Backfill existing categories based on common naming patterns
UPDATE public.categories SET report_group = 'ingresos' WHERE lower(name) IN ('ventas', 'ingresos', 'otros ingresos');
UPDATE public.categories SET report_group = 'costos_operacionales' WHERE lower(name) IN ('costos', 'costo de ventas', 'materiales', 'materia prima');
UPDATE public.categories SET report_group = 'gastos_operativos' WHERE lower(name) IN ('gastos operativos', 'nómina', 'nomina', 'servicios', 'arriendo', 'proveedores', 'transporte', 'mantenimiento', 'marketing', 'publicidad');
UPDATE public.categories SET report_group = 'impuestos' WHERE lower(name) IN ('impuestos', 'retenciones', 'iva', 'reteica', 'retefuente', '4x1000');
