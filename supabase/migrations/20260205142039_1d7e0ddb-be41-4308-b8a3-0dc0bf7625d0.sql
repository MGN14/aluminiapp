-- Add RETEICA configuration to profiles table
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS reteica_city TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reteica_rate NUMERIC DEFAULT 0;

-- Add RETEICA fields to transactions table
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS has_reteica BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reteica_amount NUMERIC DEFAULT 0;

-- Add comment to explain the fields
COMMENT ON COLUMN public.profiles.reteica_city IS 'City where the company declares RETEICA';
COMMENT ON COLUMN public.profiles.reteica_rate IS 'RETEICA rate as decimal (e.g., 0.004 for 0.4%)';
COMMENT ON COLUMN public.transactions.has_reteica IS 'Whether RETEICA applies to this transaction';
COMMENT ON COLUMN public.transactions.reteica_amount IS 'Calculated RETEICA amount';