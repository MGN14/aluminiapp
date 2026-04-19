-- Fiscal config: per-user tax configuration (NIT digit, ICA periodicity, renta type)
CREATE TABLE IF NOT EXISTS fiscal_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nit_digit INTEGER CHECK (nit_digit >= 0 AND nit_digit <= 9),
  ica_periodicity TEXT DEFAULT 'bimestral' CHECK (ica_periodicity IN ('bimestral', 'anual')),
  ica_city TEXT DEFAULT 'bogota',
  renta_type TEXT DEFAULT 'juridica' CHECK (renta_type IN ('juridica', 'natural')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fiscal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own fiscal config"
  ON fiscal_config FOR ALL
  USING (auth.uid() = user_id);

-- Business obligations: user-configurable recurring monthly payments
-- (arriendo, nómina, PILA, servicios, parafiscales, cesantías, otros)
CREATE TABLE IF NOT EXISTS business_obligations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('arriendo','nomina','pila','servicios','parafiscales','cesantias','otro')),
  dia_mes INTEGER NOT NULL CHECK (dia_mes >= 1 AND dia_mes <= 31),
  monto_estimado NUMERIC,
  meses TEXT[] DEFAULT ARRAY['1','2','3','4','5','6','7','8','9','10','11','12']::TEXT[], -- which months it applies
  activa BOOLEAN DEFAULT true,
  notas TEXT,
  completadas TEXT[] DEFAULT ARRAY[]::TEXT[], -- array of "YYYY-MM" strings marking completed months
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE business_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own business obligations"
  ON business_obligations FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_business_obligations_user ON business_obligations(user_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_fiscal_config_updated_at ON fiscal_config;
CREATE TRIGGER set_fiscal_config_updated_at
  BEFORE UPDATE ON fiscal_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_business_obligations_updated_at ON business_obligations;
CREATE TRIGGER set_business_obligations_updated_at
  BEFORE UPDATE ON business_obligations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
