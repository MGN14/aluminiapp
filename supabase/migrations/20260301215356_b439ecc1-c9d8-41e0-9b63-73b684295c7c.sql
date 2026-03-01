
-- Add processing_error column to invoices for tracking extraction failures
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS processing_error text;
