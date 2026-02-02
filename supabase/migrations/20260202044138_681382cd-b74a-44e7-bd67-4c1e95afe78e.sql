-- Add period fields to bank_statements
ALTER TABLE public.bank_statements 
ADD COLUMN IF NOT EXISTS statement_month integer,
ADD COLUMN IF NOT EXISTS statement_year integer,
ADD COLUMN IF NOT EXISTS period_start date,
ADD COLUMN IF NOT EXISTS period_end date;

-- Add constraint for valid months
ALTER TABLE public.bank_statements 
ADD CONSTRAINT valid_statement_month CHECK (statement_month IS NULL OR (statement_month >= 1 AND statement_month <= 12));

-- Create function to fix transaction dates based on statement period
CREATE OR REPLACE FUNCTION public.fix_transaction_dates_for_statement(p_statement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement_year integer;
  v_statement_month integer;
  v_updated_count integer;
BEGIN
  -- Get statement period info
  SELECT statement_year, statement_month 
  INTO v_statement_year, v_statement_month
  FROM bank_statements 
  WHERE id = p_statement_id;
  
  IF v_statement_year IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Update transactions that have wrong year (future dates or dates that don't match statement period)
  UPDATE transactions t
  SET date = make_date(
    v_statement_year,
    COALESCE(v_statement_month, EXTRACT(MONTH FROM t.date)::integer),
    EXTRACT(DAY FROM t.date)::integer
  )
  WHERE t.statement_id = p_statement_id
    AND EXTRACT(YEAR FROM t.date) != v_statement_year;
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN v_updated_count;
END;
$$;