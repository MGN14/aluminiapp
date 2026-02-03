-- =====================================================
-- AluminIA: Simplify transaction types & fix tax calcs
-- =====================================================

-- 1. Add new simplified 'type' column (Ingreso, Egreso, Transferencia)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_simple_type') THEN
    CREATE TYPE public.transaction_simple_type AS ENUM ('ingreso', 'egreso', 'transferencia');
  END IF;
END $$;

-- Add the new type column to transactions
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS type text DEFAULT 'egreso';

-- 2. Add soft delete columns
ALTER TABLE public.bank_statements 
ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone DEFAULT NULL;

ALTER TABLE public.bank_statements 
ADD COLUMN IF NOT EXISTS transaction_count integer DEFAULT 0;

ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone DEFAULT NULL;

-- 3. Migrate existing data: set type based on amount
UPDATE public.transactions
SET type = CASE 
  WHEN amount > 0 THEN 'ingreso'
  WHEN amount < 0 THEN 'egreso'
  ELSE 'transferencia'
END
WHERE type IS NULL OR type = 'egreso';

-- 4. Update the tax calculation trigger to handle signs correctly
CREATE OR REPLACE FUNCTION public.calculate_tax_amounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Determine type from amount if not set
  IF NEW.type IS NULL OR NEW.type = '' THEN
    IF COALESCE(NEW.amount, 0) > 0 THEN
      NEW.type := 'ingreso';
    ELSIF COALESCE(NEW.amount, 0) < 0 THEN
      NEW.type := 'egreso';
    ELSE
      NEW.type := 'transferencia';
    END IF;
  END IF;

  -- Set transaction_type for backward compatibility
  IF NEW.type = 'ingreso' THEN
    NEW.transaction_type := 'venta';
  ELSIF NEW.type = 'egreso' THEN
    NEW.transaction_type := 'compra';
  ELSE
    NEW.transaction_type := NULL;
  END IF;

  -- IVA Calculation with proper sign handling
  IF NEW.has_iva THEN
    -- Calculate IVA based on the absolute amount
    NEW.iva_amount := ABS(COALESCE(NEW.amount, 0)) * NEW.iva_rate;
    
    -- Set IVA type based on transaction type
    IF NEW.type = 'ingreso' THEN
      -- Income: IVA débito (positive, to be paid)
      NEW.iva_type := 'debito';
    ELSIF NEW.type = 'egreso' THEN
      -- Expense: IVA crédito (can be deducted)
      NEW.iva_type := 'credito';
    ELSE
      -- Transferencia: no IVA
      NEW.iva_type := NULL;
      NEW.iva_amount := 0;
    END IF;
  ELSE
    NEW.iva_type := NULL;
    NEW.iva_amount := 0;
  END IF;

  -- Retefuente: only applies to EXPENSES (egresos)
  IF NEW.has_retefuente AND NEW.type = 'egreso' THEN
    NEW.retefuente_amount := ABS(COALESCE(NEW.amount, 0)) * NEW.retefuente_rate;
  ELSE
    NEW.retefuente_amount := 0;
    -- Auto-disable retefuente for non-expenses
    IF NEW.type != 'egreso' THEN
      NEW.has_retefuente := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS calculate_tax_amounts_trigger ON public.transactions;
CREATE TRIGGER calculate_tax_amounts_trigger
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_tax_amounts();

-- 6. Create a function to update statement transaction count
CREATE OR REPLACE FUNCTION public.update_statement_transaction_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Update count for the affected statement
  IF TG_OP = 'INSERT' THEN
    UPDATE public.bank_statements 
    SET transaction_count = (
      SELECT COUNT(*) FROM public.transactions 
      WHERE statement_id = NEW.statement_id AND deleted_at IS NULL
    )
    WHERE id = NEW.statement_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL) THEN
    UPDATE public.bank_statements 
    SET transaction_count = (
      SELECT COUNT(*) FROM public.transactions 
      WHERE statement_id = COALESCE(NEW.statement_id, OLD.statement_id) AND deleted_at IS NULL
    )
    WHERE id = COALESCE(NEW.statement_id, OLD.statement_id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Create trigger for transaction count
DROP TRIGGER IF EXISTS update_statement_count_trigger ON public.transactions;
CREATE TRIGGER update_statement_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_statement_transaction_count();

-- 7. Update existing transaction counts
UPDATE public.bank_statements bs
SET transaction_count = (
  SELECT COUNT(*) FROM public.transactions t 
  WHERE t.statement_id = bs.id AND t.deleted_at IS NULL
);

-- 8. Recalculate IVA amounts for existing transactions with has_iva = true
-- This will trigger the updated function
UPDATE public.transactions
SET iva_amount = iva_amount
WHERE has_iva = true;