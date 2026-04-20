-- Extend fiscal_config with all onboarding fields
ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS nit_ultimo_digito INTEGER CHECK (nit_ultimo_digito >= 0 AND nit_ultimo_digito <= 9),
  ADD COLUMN IF NOT EXISTS persona_type TEXT CHECK (persona_type IN ('natural', 'juridica')),
  ADD COLUMN IF NOT EXISTS regimen TEXT CHECK (regimen IN ('comun', 'simple', 'especial')),
  ADD COLUMN IF NOT EXISTS responsable_iva BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS agente_retencion BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS autorretenedor BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS responsable_ica BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS facturacion_electronica BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nombre_facturador TEXT,
  ADD COLUMN IF NOT EXISTS nivel_ingresos TEXT CHECK (nivel_ingresos IN ('menos_92k_uvt', 'mas_92k_uvt')),
  ADD COLUMN IF NOT EXISTS actividad_principal TEXT CHECK (actividad_principal IN ('comercial', 'servicios', 'industrial', 'construccion', 'otro')),
  ADD COLUMN IF NOT EXISTS codigo_ciiu TEXT;

-- Track whether the user has completed initial onboarding
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

NOTIFY pgrst, 'reload schema';
