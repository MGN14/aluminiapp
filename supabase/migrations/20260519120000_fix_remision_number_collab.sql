-- HOTFIX: las remisiones creadas por COLABORADORES salen todas como REM-1.
--
-- Mismo patrón de bug que tuvimos en petty_cash_consecutivo
-- (20260509120000): hay 2 triggers BEFORE INSERT en remisiones y Postgres
-- los corre por orden alfabético del nombre:
--   1. remisiones_set_number          ('r' → corre PRIMERO)
--   2. set_user_id_to_data_owner_trg  ('s' → corre DESPUÉS)
--
-- Cuando un colaborador inserta:
--   1. remisiones_set_number corre con NEW.user_id = colab_id (lo que mandó
--      el frontend). Calcula MAX(number) WHERE user_id = colab_id. El
--      colaborador no tiene remisiones propias (son del owner) → MAX = 0 →
--      asigna REM-1.
--   2. set_user_id_to_data_owner_trg reescribe NEW.user_id = owner_id.
--   3. INSERT con (owner_id, 'REM-1') — pero el owner ya tiene REM-1..REM-N
--      → todas las remisiones nuevas del colaborador salen REM-1.
--
-- El backfill (20260518120000) las renumera pero las NUEVAS se rompen igual
-- porque el trigger sigue mal.
--
-- Fix: el trigger calcula el consecutivo usando current_data_owner() en vez
-- de NEW.user_id — así es independiente del orden de ejecución de los
-- triggers. Para el owner es idempotente (current_data_owner() == auth.uid()).

CREATE OR REPLACE FUNCTION public.set_remision_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  next_num int;
  lock_key bigint;
  effective_user_id uuid;
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    prefix := CASE WHEN NEW.module_origin = 'gerencial' THEN 'REMG' ELSE 'REM' END;

    -- user_id efectivo: para colaboradores resolvemos el owner real.
    -- Si auth.uid() es NULL (service_role / edge function) usamos
    -- NEW.user_id tal cual (la edge function ya pasa el owner correcto).
    IF auth.uid() IS NOT NULL THEN
      effective_user_id := public.current_data_owner();
      IF effective_user_id IS NULL THEN
        effective_user_id := NEW.user_id;
      END IF;
    ELSE
      effective_user_id := NEW.user_id;
    END IF;

    -- Serializar el consecutivo por (owner, module) con advisory lock.
    lock_key := hashtextextended(effective_user_id::text || ':' || prefix, 0);
    PERFORM pg_advisory_xact_lock(lock_key);

    SELECT COALESCE(MAX(
      CAST(SUBSTRING(number FROM (prefix || '-([0-9]+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.remisiones
    WHERE user_id = effective_user_id  -- antes: NEW.user_id (rompía para colab)
      AND module_origin = NEW.module_origin
      AND number IS NOT NULL
      AND number ~ ('^' || prefix || '-[0-9]+$');

    NEW.number := prefix || '-' || next_num::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remisiones_set_number ON public.remisiones;
CREATE TRIGGER remisiones_set_number
  BEFORE INSERT ON public.remisiones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_remision_number();

-- Backfill: renumerar las remisiones que se rompieron de nuevo.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      id,
      CASE WHEN module_origin = 'gerencial' THEN 'REMG' ELSE 'REM' END AS prefix,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, module_origin
        ORDER BY created_at ASC, id ASC
      ) AS seq
    FROM public.remisiones
  LOOP
    UPDATE public.remisiones
    SET number = r.prefix || '-' || r.seq::text,
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $$;
