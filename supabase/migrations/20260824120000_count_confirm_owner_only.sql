-- Cierre de inventario: confirmar es del DUEÑO, no de bodega.
--
-- La UI ya deshabilitaba el botón para colaboradores ("Solo el admin puede
-- confirmar un cierre"), pero la RLS solo pedía current_data_owner() — que
-- un colaborador SATISFACE, porque justamente comparte los datos del dueño.
-- O sea: la promesa vivía únicamente en el frontend y un colaborador podía
-- aplicar el ancla de inventario sin que el dueño revisara las diferencias.
--
-- Un colaborador de bodega sigue pudiendo: crear el borrador, corregir
-- líneas y descartarlo. Lo único reservado al dueño es la transición a
-- 'confirmado', que es la que mueve el inventario real.
--
-- auth.uid() IS NULL = service_role (edge functions, backfills): se permite,
-- no hay usuario que validar.

CREATE OR REPLACE FUNCTION public.guard_count_session_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'confirmado'
     AND COALESCE(OLD.estado, '') <> 'confirmado'
     AND auth.uid() IS NOT NULL
     AND auth.uid() <> NEW.user_id
  THEN
    RAISE EXCEPTION 'Solo el dueño de la cuenta puede confirmar un cierre de inventario. El conteo queda como borrador para que lo revise.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_count_session_confirm_trg ON public.inventory_count_sessions;
CREATE TRIGGER guard_count_session_confirm_trg
  BEFORE UPDATE ON public.inventory_count_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_count_session_confirm();

COMMENT ON FUNCTION public.guard_count_session_confirm IS
  'Bloquea que un colaborador pase una sesión de conteo a confirmado: current_data_owner() no alcanza como gate porque el colaborador comparte los datos del dueño.';

NOTIFY pgrst, 'reload schema';
