-- RPC merge_responsibles
--
-- Absorbe un beneficiario (legacy) como alias de otro (canonical).
-- Atómico: si algo falla, todo se revierte.
--
-- Pasos:
--   1. Verificar ownership del usuario actual sobre ambos responsibles.
--   2. Reasignar todas las FKs (10 tablas) del legacy → canonical.
--   3. Mover los aliases del legacy al canonical (deduplicando).
--   4. Crear alias del nombre del legacy → canonical.
--   5. Borrar el legacy responsible.
--
-- Caso de uso real (post-Siigo):
--   - "Aluminios Jh" (legacy, asignado a clientes/proveedores manualmente)
--   - "Aluminios del Eje" (canonical, viene desde Siigo)
--   merge_responsibles(jh_id, eje_id) absorbe Jh como alias de del Eje.

CREATE OR REPLACE FUNCTION public.merge_responsibles(
  p_legacy_id uuid,
  p_canonical_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_legacy_name text;
  v_legacy_user_id uuid;
  v_canonical_user_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_legacy_id = p_canonical_id THEN
    RAISE EXCEPTION 'No podés vincular un beneficiario consigo mismo';
  END IF;

  -- Verificar existencia y ownership
  SELECT user_id, name INTO v_legacy_user_id, v_legacy_name
    FROM public.responsibles WHERE id = p_legacy_id;
  SELECT user_id INTO v_canonical_user_id
    FROM public.responsibles WHERE id = p_canonical_id;

  IF v_legacy_user_id IS NULL THEN
    RAISE EXCEPTION 'Beneficiario legacy no encontrado';
  END IF;
  IF v_canonical_user_id IS NULL THEN
    RAISE EXCEPTION 'Beneficiario canonical no encontrado';
  END IF;
  IF v_legacy_user_id <> v_user_id OR v_canonical_user_id <> v_user_id THEN
    RAISE EXCEPTION 'No tenés permisos sobre estos beneficiarios';
  END IF;

  -- Reasignar refs en todas las tablas con FK responsible_id
  UPDATE public.invoices              SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.transactions          SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.transactions          SET operative_responsible_id = p_canonical_id WHERE operative_responsible_id = p_legacy_id;
  UPDATE public.cash_movements        SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.petty_cash_movements  SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.remisiones            SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.reconciliation_rules  SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;
  UPDATE public.credits               SET default_responsible_id   = p_canonical_id WHERE default_responsible_id   = p_legacy_id;
  UPDATE public.operative_receivables SET responsible_id           = p_canonical_id WHERE responsible_id           = p_legacy_id;

  -- Aliases: borrar duplicados (mismo alias case-insensitive ya en canonical) antes de mover
  DELETE FROM public.responsible_aliases
  WHERE responsible_id = p_legacy_id
    AND lower(trim(alias)) IN (
      SELECT lower(trim(alias)) FROM public.responsible_aliases WHERE responsible_id = p_canonical_id
    );

  -- Mover el resto al canonical
  UPDATE public.responsible_aliases
    SET responsible_id = p_canonical_id
    WHERE responsible_id = p_legacy_id;

  -- Crear alias del nombre del legacy → canonical (si no existe ya)
  INSERT INTO public.responsible_aliases (user_id, responsible_id, alias, source)
  SELECT v_user_id, p_canonical_id, v_legacy_name, 'manual'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.responsible_aliases
    WHERE user_id = v_user_id
      AND lower(trim(alias)) = lower(trim(v_legacy_name))
  );

  -- Borrar el legacy responsible
  DELETE FROM public.responsibles WHERE id = p_legacy_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_responsibles(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.merge_responsibles(uuid, uuid) IS
  'Absorbe un beneficiario (legacy) como alias de otro (canonical) — atómico, reasigna todas las FKs y borra el legacy.';
