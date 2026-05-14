-- Backfill de consecutivos de remisiones rotos.
--
-- Contexto: el trigger set_remision_number tuvo un bug (regex \d+ no
-- resolvía en algunos entornos) que generó múltiples remisiones con el
-- mismo número (REM-1, REM-1, REM-1...). El trigger ya está arreglado
-- (20260512120000) para inserts NUEVOS, pero las filas existentes con
-- numeración duplicada nunca se renumeraron.
--
-- Síntoma reportado por Nico: "Historial de Remisiones" muestra 4 filas
-- distintas como "REM-1".
--
-- Fix: renumerar TODAS las remisiones de forma consecutiva por
-- (user_id, module_origin), ordenadas por created_at. El campo `number`
-- es solo una etiqueta de texto — no es FK de ninguna tabla (las
-- relaciones usan remision_id UUID), así que renumerar es seguro a
-- nivel de integridad. La numeración queda densa (1, 2, 3...) sin gaps.
--
-- Idempotente: si se vuelve a correr, asigna los mismos números (el
-- ORDER BY created_at, id es determinístico).

-- 1. Garantizar que el trigger correcto esté aplicado. CREATE OR REPLACE
--    es idempotente — si la migración 20260512120000 nunca corrió (caso
--    posible: quedó pendiente), esto lo arregla. Si ya está, no cambia nada.
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

    -- Serializar el consecutivo por (user, module) con un advisory lock
    -- transaccional — elimina la race condition cuando dos inserts corren
    -- en paralelo.
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

DROP TRIGGER IF EXISTS remisiones_set_number ON public.remisiones;
CREATE TRIGGER remisiones_set_number
  BEFORE INSERT ON public.remisiones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_remision_number();

-- 2. Backfill: renumerar todas las remisiones de forma consecutiva.
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
