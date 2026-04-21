-- Add `paid_dian_events` to fiscal_config for manual "paid" flag on DIAN obligations.
-- Format: TEXT[] of keys like "iva:2026-05-12", "retefuente:2026-06-15".
-- Business obligations already have `completadas` on business_obligations.
ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS paid_dian_events TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
