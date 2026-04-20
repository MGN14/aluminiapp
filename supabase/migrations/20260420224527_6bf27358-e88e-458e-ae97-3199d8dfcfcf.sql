CREATE TABLE IF NOT EXISTS public.fiscal_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nit_digit INTEGER CHECK (nit_digit >= 0 AND nit_digit <= 9),
  ica_periodicity TEXT DEFAULT 'bimestral' CHECK (ica_periodicity IN ('bimestral', 'anual')),
  ica_city TEXT DEFAULT 'bogota',
  renta_type TEXT DEFAULT 'juridica' CHECK (renta_type IN ('juridica', 'natural')),
  nit_ultimo_digito INTEGER CHECK (nit_ultimo_digito >= 0 AND nit_ultimo_digito <= 9),
  persona_type TEXT CHECK (persona_type IN ('natural', 'juridica')),
  regimen TEXT CHECK (regimen IN ('comun', 'simple', 'especial')),
  responsable_iva BOOLEAN DEFAULT false,
  agente_retencion BOOLEAN DEFAULT false,
  autorretenedor BOOLEAN DEFAULT false,
  responsable_ica BOOLEAN DEFAULT false,
  facturacion_electronica BOOLEAN DEFAULT false,
  nombre_facturador TEXT,
  nivel_ingresos TEXT CHECK (nivel_ingresos IN ('menos_92k_uvt', 'mas_92k_uvt')),
  actividad_principal TEXT CHECK (actividad_principal IN ('comercial', 'servicios', 'industrial', 'construccion', 'otro')),
  codigo_ciiu TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.fiscal_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own fiscal config" ON public.fiscal_config;
CREATE POLICY "Users manage their own fiscal config" ON public.fiscal_config FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;