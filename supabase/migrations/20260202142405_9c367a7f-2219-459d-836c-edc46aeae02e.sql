-- Add transaction_type column (compra/venta)
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS transaction_type text DEFAULT 'compra' CHECK (transaction_type IN ('compra', 'venta'));

-- Add iva_type column (credito/debito) - derived from transaction_type
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS iva_type text CHECK (iva_type IS NULL OR iva_type IN ('credito', 'debito'));

-- Update existing transactions: positive amounts = ventas, negative = compras
UPDATE public.transactions 
SET transaction_type = CASE 
  WHEN amount >= 0 THEN 'venta' 
  ELSE 'compra' 
END
WHERE transaction_type IS NULL OR transaction_type = 'compra';

-- Update iva_type for transactions that have IVA
UPDATE public.transactions 
SET iva_type = CASE 
  WHEN has_iva AND transaction_type = 'venta' THEN 'debito'
  WHEN has_iva AND transaction_type = 'compra' THEN 'credito'
  ELSE NULL 
END;

-- Drop the old trigger and function using CASCADE
DROP FUNCTION IF EXISTS public.calculate_tax_amounts() CASCADE;

-- Create improved tax calculation trigger function
CREATE OR REPLACE FUNCTION public.calculate_tax_amounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set iva_type based on transaction_type when has_iva is true
  IF NEW.has_iva THEN
    IF NEW.transaction_type = 'venta' THEN
      NEW.iva_type := 'debito';
      -- IVA on sales: amount * rate (positive amount expected)
      NEW.iva_amount := COALESCE(ABS(NEW.amount), 0) * NEW.iva_rate;
    ELSIF NEW.transaction_type = 'compra' THEN
      NEW.iva_type := 'credito';
      -- IVA on purchases: abs(amount) * rate
      NEW.iva_amount := COALESCE(ABS(NEW.amount), 0) * NEW.iva_rate;
    ELSE
      NEW.iva_type := NULL;
      NEW.iva_amount := 0;
    END IF;
  ELSE
    NEW.iva_type := NULL;
    NEW.iva_amount := 0;
  END IF;

  -- Retefuente: only applies to PURCHASES (compras), never to sales
  IF NEW.has_retefuente AND NEW.transaction_type = 'compra' THEN
    NEW.retefuente_amount := COALESCE(ABS(NEW.amount), 0) * NEW.retefuente_rate;
  ELSE
    NEW.retefuente_amount := 0;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create the trigger
CREATE TRIGGER trigger_calculate_tax_amounts
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.calculate_tax_amounts();

-- Recalculate all existing IVA and retefuente amounts with the new logic
UPDATE public.transactions SET 
  iva_amount = CASE 
    WHEN has_iva THEN COALESCE(ABS(amount), 0) * iva_rate 
    ELSE 0 
  END,
  iva_type = CASE 
    WHEN has_iva AND transaction_type = 'venta' THEN 'debito'
    WHEN has_iva AND transaction_type = 'compra' THEN 'credito'
    ELSE NULL 
  END,
  retefuente_amount = CASE 
    WHEN has_retefuente AND transaction_type = 'compra' THEN COALESCE(ABS(amount), 0) * retefuente_rate 
    ELSE 0 
  END;