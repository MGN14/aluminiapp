-- Add operational_type column for operational clarity (not accounting)
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS operational_type text DEFAULT 'otros';

-- Update existing transactions based on transaction_type
UPDATE public.transactions
SET operational_type = CASE 
  WHEN transaction_type = 'venta' THEN 'ingreso'
  WHEN transaction_type = 'compra' THEN 'gasto_operativo'
  ELSE 'otros'
END
WHERE operational_type IS NULL OR operational_type = 'otros';

-- Create function to set default operational_type based on transaction_type
CREATE OR REPLACE FUNCTION public.set_default_operational_type()
RETURNS TRIGGER AS $$
BEGIN
  -- Only set default if operational_type is not explicitly provided or is null
  IF NEW.operational_type IS NULL OR NEW.operational_type = '' THEN
    IF NEW.transaction_type = 'venta' THEN
      NEW.operational_type := 'ingreso';
    ELSIF NEW.transaction_type = 'compra' THEN
      NEW.operational_type := 'gasto_operativo';
    ELSE
      NEW.operational_type := 'otros';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for default operational_type
DROP TRIGGER IF EXISTS set_operational_type_trigger ON public.transactions;
CREATE TRIGGER set_operational_type_trigger
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.set_default_operational_type();