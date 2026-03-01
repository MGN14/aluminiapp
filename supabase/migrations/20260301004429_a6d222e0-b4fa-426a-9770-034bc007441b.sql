
-- 1. Add 'pro' to subscription_plan enum
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'pro';

-- 2. Add new columns to invoices table
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS counterparty_name text,
  ADD COLUMN IF NOT EXISTS counterparty_nit text,
  ADD COLUMN IF NOT EXISTS extracted_data jsonb,
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS autoretefuente_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS autoretefuente_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reteica_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reteica_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_path text;

-- 3. Update status constraint: drop old, add new that supports both old and new values
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check 
  CHECK (status IN ('sin_conciliar', 'parcial', 'conciliada', 'draft', 'confirmed'));

-- 4. Add invoice_id (nullable) to transactions for future conciliation
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
