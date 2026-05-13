-- Defensa en profundidad para el flow de colaboradores.
--
-- Hardening reportado en security audit:
--
-- 1. current_data_owner() chequea ahora force_password_change. Si el
--    colaborador está autenticado por magic link pero todavía no completó
--    el setup de password (escenario: magic link válido + frontend gate
--    bypaseado por dev tools), la función devuelve su propio auth.uid()
--    en lugar del owner — por lo tanto RLS no le devuelve nada del dueño.
--    Sin esto, la defensa vivía SOLO en el frontend; ahora también en SQL.
--
-- 2. status pasa de blocklist (NOT IN revoked/deleted/inactive) a
--    allowlist explícita (IN pending/active). Si alguien introduce un
--    estado nuevo en el futuro (ej: 'suspended', 'frozen'), por default
--    queda bloqueado en vez de ser tratado como vivo por accidente.
--
-- 3. CHECK constraint sobre status: solo permite los valores conocidos.
--    Limpiamos cualquier registro con valor invalido antes de aplicarlo
--    (normalizamos a 'revoked' los que no calcen — defensivo).

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
  v_pwd_pending boolean;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NULL;
  END IF;

  -- Si el usuario tiene force_password_change=true, NO es elegible para
  -- ver datos del owner. El frontend lo manda a /change-password, pero
  -- alguien con dev tools podría intentar queries directas — esta defensa
  -- SQL bloquea ese caso.
  SELECT COALESCE(force_password_change, false)
  INTO v_pwd_pending
  FROM public.profiles
  WHERE user_id = v_caller;

  IF v_pwd_pending THEN
    RETURN v_caller;
  END IF;

  -- Allowlist explícita: solo 'pending' (recién aceptó invite) o 'active'
  -- (uso normal). Cualquier otro estado bloquea acceso.
  SELECT owner_user_id
  INTO v_owner
  FROM public.collaborators
  WHERE collaborator_user_id = v_caller
    AND status IN ('pending', 'active')
  ORDER BY
    CASE WHEN status = 'active' THEN 0 ELSE 1 END,
    invited_at DESC NULLS LAST
  LIMIT 1;

  RETURN COALESCE(v_owner, v_caller);
END;
$$;

-- Normalizar valores antes del CHECK constraint, por si la DB tiene
-- algún registro con estado inesperado.
UPDATE public.collaborators
SET status = 'revoked'
WHERE status NOT IN ('pending', 'active', 'revoked', 'deleted', 'inactive');

-- Solo agregar el CHECK si todavía no existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collaborators_status_check'
  ) THEN
    ALTER TABLE public.collaborators
      ADD CONSTRAINT collaborators_status_check
      CHECK (status IN ('pending', 'active', 'revoked', 'deleted', 'inactive'));
  END IF;
END $$;
