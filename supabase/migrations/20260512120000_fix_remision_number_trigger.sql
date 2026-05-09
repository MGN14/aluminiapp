-- Fix: trigger set_remision_number generaba todas las remisiones como 'REM-1'.
--
-- Bug original (20260429160000): el regex `\d+` puede no resolver en algunos
-- entornos cuando la function se recompila con search_path distinto. Re-creamos
-- usando `[0-9]+` (POSIX puro) que es 100% portable, y agregamos pg_advisory_xact_lock
-- para serializar inserts del mismo (user, module_origin) y eliminar la race condition
-- residual cuando dos clientes insertan en paralelo.
--
-- NO renumera filas existentes. El backfill de las REM-1 duplicadas se hace
-- aparte (script manual que el founder revisa antes de correr) porque renumerar
-- afecta identificadores que pueden haberse comunicado a clientes finales.

DROP TRIGGER IF EXISTS remisiones_set_number ON public.remisiones;
DROP FUNCTION IF EXISTS public.set_remision_number();

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
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    prefix := CASE WHEN NEW.module_origin = 'gerencial' THEN 'REMG' ELSE 'REM' END;

    -- Serializar consecutivo por (user, module). hashtextextended produce un bigint
    -- estable; el lock se libera al finalizar la transaccion.
    lock_key := hashtextextended(NEW.user_id::text || ':' || prefix, 0);
    PERFORM pg_advisory_xact_lock(lock_key);

    SELECT COALESCE(MAX(
      CAST(SUBSTRING(number FROM (prefix || '-([0-9]+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.remisiones
    WHERE user_id = NEW.user_id
      AND module_origin = NEW.module_origin
      AND number IS NOT NULL
      AND number ~ ('^' || prefix || '-[0-9]+$');

    NEW.number := prefix || '-' || next_num::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER remisiones_set_number
  BEFORE INSERT ON public.remisiones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_remision_number();
