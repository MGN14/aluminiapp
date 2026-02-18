
-- Add account_number and display_name to bank_statements
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS display_name text;

-- Populate display_name for existing records using statement_month/year
UPDATE public.bank_statements
SET display_name = bank_name || ' ' ||
  CASE COALESCE(statement_month, 0)
    WHEN 1 THEN 'Ene' WHEN 2 THEN 'Feb' WHEN 3 THEN 'Mar'
    WHEN 4 THEN 'Abr' WHEN 5 THEN 'May' WHEN 6 THEN 'Jun'
    WHEN 7 THEN 'Jul' WHEN 8 THEN 'Ago' WHEN 9 THEN 'Sep'
    WHEN 10 THEN 'Oct' WHEN 11 THEN 'Nov' WHEN 12 THEN 'Dic'
    ELSE ''
  END || ' ' || COALESCE(statement_year::text, '')
WHERE display_name IS NULL
  AND statement_month IS NOT NULL
  AND statement_year IS NOT NULL;

-- For records without month/year, use file_name as fallback
UPDATE public.bank_statements
SET display_name = file_name
WHERE display_name IS NULL OR display_name = '';

-- Unique constraint: one extracto per user+bank+month+year (only when month and year are set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statements_unique_period
  ON public.bank_statements (user_id, bank_name, statement_month, statement_year)
  WHERE deleted_at IS NULL AND statement_month IS NOT NULL AND statement_year IS NOT NULL;
