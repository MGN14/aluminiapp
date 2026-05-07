-- HOTFIX: cuando un colaborador inserta un movimiento en
-- petty_cash_movements, choca con "duplicate key value violates unique
-- constraint petty_cash_consecutivo_user_unique".
--
-- Causa: hay 2 triggers BEFORE INSERT en la tabla:
--   1. petty_cash_set_consecutivo (orden alfabético: 'p')
--   2. set_user_id_to_data_owner_trg (orden alfabético: 's')
--
-- Postgres los corre por nombre, así que el del consecutivo corre PRIMERO
-- con NEW.user_id = colab_id (lo que mandó el frontend). Calcula MAX entre
-- rows del COLABORADOR (= 0), asigna 'CP-YYYY-0001'. Luego el trigger 2
-- reescribe NEW.user_id al owner, pero el consecutivo ya está calculado.
-- Si el owner ya tenía 'CP-YYYY-0001' → unique violation.
--
-- Fix: que la función del consecutivo calcule el MAX usando
-- current_data_owner() en lugar de NEW.user_id, así es independiente del
-- orden de ejecución de los triggers. Y aprovecha para reescribir
-- NEW.user_id al owner si todavía no se hizo.

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
  -- Determinar el user_id efectivo (owner para colaboradores).
  -- Si auth.uid() existe → resolver via current_data_owner() (owner real).
  -- Si auth.uid() es NULL (service_role) → usar NEW.user_id tal cual.
  IF auth.uid() IS NOT NULL THEN
    effective_user_id := public.current_data_owner();
    IF effective_user_id IS NULL THEN
      effective_user_id := NEW.user_id;
    END IF;
  ELSE
    effective_user_id := NEW.user_id;
  END IF;

  IF (NEW.numero_consecutivo IS NULL OR NEW.numero_consecutivo = '') THEN
    year_str := to_char(NEW.date, 'YYYY');
    prefix := CASE WHEN NEW.kind = 'cuenta_de_cobro' THEN 'CDC' ELSE 'CP' END;
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(numero_consecutivo FROM (prefix || '-' || year_str || '-(\d+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.petty_cash_movements
    WHERE user_id = effective_user_id  -- antes: NEW.user_id (rompía para colab)
      AND numero_consecutivo IS NOT NULL
      AND numero_consecutivo ~ ('^' || prefix || '-' || year_str || '-\d+$');
    NEW.numero_consecutivo := prefix || '-' || year_str || '-' || lpad(next_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
