CREATE TABLE IF NOT EXISTS public.reconciliation_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  pattern_ref TEXT,
  keyword TEXT,
  amount_min NUMERIC,
  amount_max NUMERIC,
  day_min INTEGER,
  day_max INTEGER,
  tx_type TEXT NOT NULL DEFAULT 'egreso' CHECK (tx_type IN ('ingreso', 'egreso')),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  category_name TEXT,
  responsible_id UUID REFERENCES public.responsibles(id) ON DELETE SET NULL,
  responsible_name TEXT,
  auto_conciliate BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  match_count INTEGER NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reconciliation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reconciliation rules"
  ON public.reconciliation_rules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own reconciliation rules"
  ON public.reconciliation_rules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own reconciliation rules"
  ON public.reconciliation_rules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own reconciliation rules"
  ON public.reconciliation_rules FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_reconciliation_rules_user_id ON public.reconciliation_rules(user_id);
CREATE INDEX idx_reconciliation_rules_active ON public.reconciliation_rules(user_id, active) WHERE active = true;

CREATE TRIGGER update_reconciliation_rules_updated_at
  BEFORE UPDATE ON public.reconciliation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();