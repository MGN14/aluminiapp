-- HOTFIX: current_data_owner() filtraba status='active' pero el invite-
-- collaborator deja al colaborador en status='pending' hasta que se
-- "active" manualmente. El user completaba el setup de password y entraba
-- a la app, pero RLS no le mostraba ningún dato del owner — porque la
-- función devolvía NULL y caía al COALESCE(NULL, v_caller) = su propio
-- auth.uid (que no es dueño de los datos).
--
-- Síntoma reportado: colaboradora entra tras setear contraseña y la app
-- "no muestra nada de la cuenta de Nico".
--
-- Fix: aceptar status NOT IN ('revoked', 'deleted'). Mientras la
-- invitación esté viva (pending o active), el colaborador ve los datos
-- del owner. Si el owner revoca, se filtra y deja de ver.
--
-- Como bonus, también marcamos status='active' + accepted_at=now() al
-- primer hit — el invite queda canónicamente "aceptado" cuando el user
-- realmente entra, no antes.

CREATE OR REPLACE FUNCTION public.current_data_owner()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_owner uuid;
  v_collab_id uuid;
  v_status text;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NULL;
  END IF;

  -- Buscar la fila de colaborador. Aceptamos cualquier status que NO sea
  -- 'revoked' o 'deleted'. Antes era solo 'active' y dejaba a los
  -- 'pending' (recién registrados via invite link) sin acceso a la data.
  SELECT id, owner_user_id, status
  INTO v_collab_id, v_owner, v_status
  FROM public.collaborators
  WHERE collaborator_user_id = v_caller
    AND COALESCE(status, '') NOT IN ('revoked', 'deleted', 'inactive')
  ORDER BY
    CASE WHEN status = 'active' THEN 0 ELSE 1 END,
    invited_at DESC NULLS LAST
  LIMIT 1;

  RETURN COALESCE(v_owner, v_caller);
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_data_owner() TO authenticated;

-- Función helper para "aceptar" formalmente la invitación tras el primer
-- login. La llamamos desde el frontend al completar el setup de password.
-- Idempotente: si ya está active, no toca nada.
CREATE OR REPLACE FUNCTION public.mark_collaborator_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RETURN; END IF;

  UPDATE public.collaborators
  SET status = 'active',
      accepted_at = COALESCE(accepted_at, now())
  WHERE collaborator_user_id = v_caller
    AND COALESCE(status, '') NOT IN ('revoked', 'deleted', 'inactive')
    AND status IS DISTINCT FROM 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_collaborator_active() TO authenticated;
