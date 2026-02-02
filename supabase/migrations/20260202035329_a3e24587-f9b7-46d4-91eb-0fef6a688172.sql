-- Update transactions table: remove old VAT/DIAN fields, add Colombian tax logic fields
-- Drop old computed column first
ALTER TABLE public.transactions DROP COLUMN IF EXISTS vat_amount;

-- Drop old fields
ALTER TABLE public.transactions DROP COLUMN IF EXISTS has_vat;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS vat_percentage;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS affects_dian;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS withholding;

-- Add new Colombian tax fields
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS applies_iva BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS applies_retefuente BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sucursal TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS dcto TEXT;

-- Add useful indexes
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_applies_iva ON public.transactions(applies_iva) WHERE applies_iva = true;
CREATE INDEX IF NOT EXISTS idx_transactions_applies_retefuente ON public.transactions(applies_retefuente) WHERE applies_retefuente = true;
CREATE INDEX IF NOT EXISTS idx_transactions_reconciled ON public.transactions(reconciled) WHERE reconciled = false;