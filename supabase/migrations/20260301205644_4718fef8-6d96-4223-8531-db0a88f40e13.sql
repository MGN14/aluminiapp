
-- Add display_name and original_filename columns to invoices table
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS original_filename text;
