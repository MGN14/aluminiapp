-- Refactor: comprobante de ingreso ya NO es una tabla independiente,
-- es una feature integrada en Caja Menor (petty_cash_movements con kind='ingreso_efectivo').
--
-- Cambios:
-- 1) Drop tabla income_receipts (verificado: 0 rows, creada el 2026-05-25 y nunca usada)
-- 2) Extender trigger set_petty_cash_consecutivo() para asignar prefijo CI-YYYY-NNNN
--    cuando kind='ingreso_efectivo' (análogo a CDC-YYYY-NNNN para cuenta_de_cobro)

DROP TABLE IF EXISTS public.income_receipts CASCADE;
DROP FUNCTION IF EXISTS public.set_income_receipt_consecutivo() CASCADE;

-- Reescribir trigger para soportar:
--   kind='cuenta_de_cobro'  → CDC-YYYY-NNNN (legacy)
--   kind='ingreso_efectivo' → CI-YYYY-NNNN  (nuevo: comprobante de ingreso)
--   otros kinds (gasto_efectivo) → sin consecutivo automático
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
  -- Solo asignar si NEW.numero_consecutivo está vacío y el kind requiere consecutivo.
  IF (NEW.numero_consecutivo IS NULL OR NEW.numero_consecutivo = '') THEN
    IF NEW.kind = 'cuenta_de_cobro' THEN
      prefix := 'CDC';
    ELSIF NEW.kind = 'ingreso_efectivo' THEN
      prefix := 'CI';
    ELSE
      -- Otros kinds (gasto_efectivo) no llevan consecutivo automático.
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

-- El trigger ya existe en la tabla (creado por la migration original de cuenta de cobro).
-- Solo redefinimos la función — el trigger sigue apuntando a ella.

COMMENT ON FUNCTION public.set_petty_cash_consecutivo() IS
  'Asigna numero_consecutivo automáticamente: CDC-YYYY-NNNN para cuenta_de_cobro, CI-YYYY-NNNN para ingreso_efectivo. Secuencial por usuario y año.';

-- =============================================================================
-- Backfill: asignar CI-YYYY-NNNN a movimientos ingreso_efectivo existentes
-- que no tengan consecutivo. (Para que ya tengan número al estrenar la feature.)
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  yr text;
  cnt int;
BEGIN
  FOR r IN
    SELECT id, user_id, date
    FROM public.petty_cash_movements
    WHERE kind = 'ingreso_efectivo'
      AND (numero_consecutivo IS NULL OR numero_consecutivo = '')
    ORDER BY user_id, date, created_at
  LOOP
    yr := to_char(r.date, 'YYYY');
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(numero_consecutivo FROM ('CI-' || yr || '-(\d+)$')) AS int)
    ), 0) + 1
    INTO cnt
    FROM public.petty_cash_movements
    WHERE user_id = r.user_id
      AND numero_consecutivo IS NOT NULL
      AND numero_consecutivo ~ ('^CI-' || yr || '-\d+$');
    UPDATE public.petty_cash_movements
    SET numero_consecutivo = 'CI-' || yr || '-' || lpad(cnt::text, 4, '0')
    WHERE id = r.id;
  END LOOP;
END;
$$;
