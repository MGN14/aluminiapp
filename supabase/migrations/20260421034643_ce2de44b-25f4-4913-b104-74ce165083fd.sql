-- Add paid_dian_events column to fiscal_config table
ALTER TABLE fiscal_config ADD COLUMN IF NOT EXISTS paid_dian_events TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';