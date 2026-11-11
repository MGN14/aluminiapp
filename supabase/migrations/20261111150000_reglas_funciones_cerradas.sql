-- ============================================================================
-- Funciones de reglas de conciliación: quién las puede ejecutar y sobre quién
-- ============================================================================
-- Auditoría 2026-11-11 (confirmado en producción con has_function_privilege):
--
--   1. apply_pending_rules_for_user y apply_reconciliation_rules_to_tx eran
--      ejecutables por `anon` (el permiso por defecto de las funciones nunca
--      se revocó). Son SECURITY DEFINER y la primera aceptaba el p_user_id que
--      mandara quien llama: cualquiera con la llave pública podía disparar el
--      barrido de reglas sobre la cuenta de OTRO usuario. No expone datos (solo
--      aplica las reglas de esa misma cuenta y devuelve dos conteos), pero no
--      debe poder hacerse.
--
--   2. Colaboradores: la app manda p_user_id = el id del que está logueado.
--      Para un colaborador ese id no es el dueño de los datos, así que el
--      barrido no encontraba nada y las reglas nunca se re-aplicaban cuando
--      conciliaba un colaborador (hay 2 activos).
--
-- Cambios:
--   · apply_pending_rules_for_user: si hay sesión de usuario, SIEMPRE trabaja
--     sobre current_data_owner() (dueño → él mismo; colaborador → su dueño) e
--     ignora p_user_id. Sin sesión de usuario (service_role del cron / edge
--     function, o SQL directo) sigue usando p_user_id. `anon` no puede.
--   · apply_reconciliation_rules_to_tx: ya no es un RPC público. La siguen
--     usando el trigger al insertar y el barrido (ambos SECURITY DEFINER,
--     dueño postgres: ejecutan con los permisos del dueño, no del usuario).
--     El cuerpo de esa función NO cambia.
--
-- Misma firma y mismo tipo de retorno: CREATE OR REPLACE alcanza.

CREATE OR REPLACE FUNCTION public.apply_pending_rules_for_user(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_source text DEFAULT 'retro_cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_tx_id uuid;
  v_rule_id uuid;
  v_processed integer := 0;
  v_matched integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    -- Usuario con sesión: siempre los datos de SU empresa, mande el id que mande.
    v_user := public.current_data_owner();
  ELSIF COALESCE(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'No autorizado';
  ELSE
    -- Sin sesión de usuario: service_role (cron / edge function) o SQL directo.
    v_user := p_user_id;
  END IF;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No user id provided and no auth.uid()';
  END IF;

  FOR v_tx_id IN
    SELECT id FROM public.transactions
    WHERE user_id = v_user
      AND deleted_at IS NULL
      AND (category_id IS NULL OR responsible_id IS NULL)
    ORDER BY date DESC
    LIMIT p_limit
  LOOP
    v_processed := v_processed + 1;
    v_rule_id := public.apply_reconciliation_rules_to_tx(v_tx_id, p_source);
    IF v_rule_id IS NOT NULL THEN v_matched := v_matched + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'user_id', v_user,
    'processed', v_processed,
    'matched', v_matched,
    'source', p_source
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pending_rules_for_user(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_pending_rules_for_user(uuid, integer, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.apply_reconciliation_rules_to_tx(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_reconciliation_rules_to_tx(uuid, text) TO service_role;

COMMENT ON FUNCTION public.apply_pending_rules_for_user(uuid, integer, text) IS
  'Aplica reglas retroactivamente a las TX pendientes. Con sesión de usuario trabaja siempre sobre current_data_owner() (ignora p_user_id); sin sesión (service_role / SQL directo) usa p_user_id. anon no puede ejecutarla.';
