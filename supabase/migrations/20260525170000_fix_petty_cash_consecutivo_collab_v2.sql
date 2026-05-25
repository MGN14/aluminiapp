-- HOTFIX urgente: se rompió otra vez el insert de petty_cash_movements para
-- colaboradoras con "duplicate key value violates unique constraint
-- petty_cash_consecutivo_user_unique".
--
-- Causa: la migración 20260525160000_rename_ci_to_cp.sql hizo CREATE OR
-- REPLACE de set_petty_cash_consecutivo() para cambiar CI→CP, pero al
-- reescribirla perdió la lógica que resolvía el owner real cuando el caller
-- es colaborador. Volvió a usar NEW.user_id directamente.
--
-- Esto reintroduce exactamente el bug que ya se había arreglado en
-- 20260509120000_fix_petty_cash_consecutivo_collab.sql:
--   1. petty_cash_set_consecutivo (orden alfabético: 'p') corre primero
--   2. set_user_id_to_data_owner_trg (orden alfabético: 's') corre después
-- El consecutivo se calcula contra el colab (rows=0 → 0001) y luego se
-- reescribe NEW.user_id al owner, chocando contra el unique constraint.
--
-- Fix: recombinar las dos lógicas — current_data_owner() para el MAX +
-- prefijos CDC/CP del rename.

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
  effective_user_id uuid;
BEGIN
  -- Resolver owner real (para colaboradores) e independizarse del orden
  -- de ejecución de los triggers BEFORE INSERT.
  IF auth.uid() IS NOT NULL THEN
    effective_user_id := public.current_data_owner();
    IF effective_user_id IS NULL THEN
      effective_user_id := NEW.user_id;
    END IF;
  ELSE
    effective_user_id := NEW.user_id;
  END IF;

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
    WHERE user_id = effective_user_id  -- antes (regresión): NEW.user_id
      AND numero_consecutivo IS NOT NULL
      AND numero_consecutivo ~ ('^' || prefix || '-' || year_str || '-\d+$');

    NEW.numero_consecutivo := prefix || '-' || year_str || '-' || lpad(next_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_petty_cash_consecutivo() IS
  'Asigna numero_consecutivo: CDC-YYYY-NNNN para cuenta_de_cobro, CP-YYYY-NNNN para ingreso_efectivo. Usa current_data_owner() para que colaboradores tomen el consecutivo del owner.';
