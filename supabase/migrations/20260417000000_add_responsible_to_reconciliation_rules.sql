-- Add responsible_id / responsible_name to reconciliation_rules
ALTER TABLE public.reconciliation_rules
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES public.responsibles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_name TEXT;

NOTIFY pgrst, 'reload schema';
