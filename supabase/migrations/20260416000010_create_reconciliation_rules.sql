-- Reconciliation rules: Nico auto-categorizes transactions matching patterns
CREATE TABLE IF NOT EXISTS reconciliation_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  pattern_ref TEXT,         -- id of the source business_pattern
  keyword TEXT,             -- case-insensitive match in transaction description
  amount_min NUMERIC,
  amount_max NUMERIC,
  day_min INTEGER,          -- day-of-month range (1-31)
  day_max INTEGER,
  tx_type TEXT DEFAULT 'egreso' CHECK (tx_type IN ('ingreso', 'egreso')),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  category_name TEXT,       -- denormalized for display
  auto_conciliate BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  match_count INTEGER DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reconciliation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own reconciliation rules"
  ON reconciliation_rules FOR ALL
  USING (auth.uid() = user_id);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
