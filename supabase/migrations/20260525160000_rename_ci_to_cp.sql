-- Rename: el documento que se entrega al cliente cuando recibe un pago
-- debe llamarse "Comprobante de Pago" (CP), no "Comprobante de Ingreso" (CI).
-- Desde la perspectiva del cliente, es la constancia de que él pagó.
--
-- Cambios:
-- 1) Trigger set_petty_cash_consecutivo: prefix CP- en lugar de CI- para ingreso_efectivo
-- 2) Backfill: renombrar consecutivos existentes CI-YYYY-NNNN → CP-YYYY-NNNN

CREATE OR REPLACE FUNCTION public.set_petty_cash_consecutivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num int;
  year_str text;
  prefix text;
BEGIN
  IF (NEW.numero_consecutivo IS NULL OR NEW.numero_consecutivo = '') THEN
    IF NEW.kind = 'cuenta_de_cobro' THEN
      prefix := 'CDC';
    ELSIF NEW.kind = 'ingreso_efectivo' THEN
      prefix := 'CP'; -- Comprobante de Pago (al cliente)
    ELSE
      RETURN NEW;
    END IF;

    year_str := to_char(NEW.date, 'YYYY');
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(numero_consecutivo FROM (prefix || '-' || year_str || '-(\d+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.petty_cash_movements
    WHERE user_id = NEW.user_id
      AND numero_consecutivo IS NOT NULL
      AND numero_consecutivo ~ ('^' || prefix || '-' || year_str || '-\d+$');

    NEW.numero_consecutivo := prefix || '-' || year_str || '-' || lpad(next_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_petty_cash_consecutivo() IS
  'Asigna numero_consecutivo: CDC-YYYY-NNNN para cuenta_de_cobro, CP-YYYY-NNNN para ingreso_efectivo (comprobante de pago al cliente).';

-- Backfill: cambiar todos los CI-YYYY-NNNN existentes a CP-YYYY-NNNN
-- Preserva el número (CI-2026-0001 → CP-2026-0001) para no romper referencias.
UPDATE public.petty_cash_movements
SET numero_consecutivo = REGEXP_REPLACE(numero_consecutivo, '^CI-', 'CP-')
WHERE numero_consecutivo ~ '^CI-\d{4}-\d+$';
