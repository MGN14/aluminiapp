-- HOTFIX urgente: el trigger set_user_id_to_data_owner_trg estaba reescribiendo
-- NEW.user_id a NULL cuando el INSERT venía de una edge function que usa
-- service_role (parse-bancolombia-csv y otras). En ese contexto auth.uid() es
-- NULL, public.current_data_owner() devuelve NULL, y el trigger escribía NULL,
-- lo que rompía el NOT NULL constraint con el error:
--   "null value in column 'user_id' of relation 'transactions' violates not-null constraint"
--
-- Comportamiento corregido:
--   - Si hay un caller autenticado (auth.uid() ≠ NULL): el trigger reescribe
--     NEW.user_id al owner efectivo (caso normal del frontend del owner o
--     colaborador).
--   - Si auth.uid() IS NULL (service_role / edge function): el trigger
--     conserva NEW.user_id tal como viene en el INSERT. La edge function ya
--     pasa el user_id correcto del statement/owner (es responsabilidad de la
--     edge function). El trigger solo se mete cuando hay un usuario real.

CREATE OR REPLACE FUNCTION public.set_user_id_to_data_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- Solo reescribir cuando el caller es un usuario autenticado.
  -- service_role no setea auth.uid() → se conserva NEW.user_id intacto.
  IF auth.uid() IS NOT NULL THEN
    v_owner := public.current_data_owner();
    IF v_owner IS NOT NULL THEN
      NEW.user_id := v_owner;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
