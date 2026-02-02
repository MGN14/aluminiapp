-- Add new columns to transactions table
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS amount numeric,
ADD COLUMN IF NOT EXISTS owner text,
ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS has_vat boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS vat_percentage numeric NOT NULL DEFAULT 19,
ADD COLUMN IF NOT EXISTS vat_amount numeric GENERATED ALWAYS AS (
  CASE WHEN has_vat THEN ROUND(amount * vat_percentage / 100, 2) ELSE 0 END
) STORED,
ADD COLUMN IF NOT EXISTS withholding numeric,
ADD COLUMN IF NOT EXISTS affects_dian boolean NOT NULL DEFAULT false;

-- Update amount from existing debit/credit
UPDATE public.transactions 
SET amount = COALESCE(credit, 0) - COALESCE(debit, 0)
WHERE amount IS NULL;