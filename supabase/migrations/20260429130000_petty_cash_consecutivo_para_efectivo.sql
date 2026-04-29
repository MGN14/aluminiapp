-- Caja Menor: extender el trigger de consecutivo a gastos en efectivo.
-- Cuenta de cobro → CDC-YYYY-NNNN
-- Gasto en efectivo → CP-YYYY-NNNN  (Comprobante de Pago)
-- Secuencias separadas, ambas por usuario y por anio.
-- Backfill al final para cuentas existentes que no tienen consecutivo.

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
    year_str := to_char(NEW.date, 'YYYY');
    prefix := CASE WHEN NEW.kind = 'cuenta_de_cobro' THEN 'CDC' ELSE 'CP' END;
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

-- Backfill: asignar consecutivos a movimientos existentes sin numero
WITH ordered AS (
  SELECT
    id,
    user_id,
    kind,
    date,
    CASE WHEN kind = 'cuenta_de_cobro' THEN 'CDC' ELSE 'CP' END AS prefix,
    to_char(date, 'YYYY') AS year_str,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, kind, EXTRACT(YEAR FROM date)
      ORDER BY created_at, id
    ) AS rn
  FROM public.petty_cash_movements
  WHERE numero_consecutivo IS NULL
)
UPDATE public.petty_cash_movements pcm
SET numero_consecutivo = ordered.prefix || '-' || ordered.year_str || '-' || lpad(ordered.rn::text, 4, '0')
FROM ordered
WHERE pcm.id = ordered.id;
