-- Reescribe check_pdf_upload_limit para contar dinámicamente desde
-- bank_statements en vez de mantener un contador separado.
--
-- Pedido del cliente (post-demo en producción):
--   "el límite solo sea para extractos efectivos en extractos bancarios.
--    Si el usuario los borra se resetea el límite."
--
-- Ventajas del nuevo enfoque:
--   1. Borrar un statement libera el cupo automáticamente (deleted_at IS NULL).
--   2. Intentos fallidos (Gemini devolvió 0 transacciones) no consumen cupo.
--   3. No hay desync entre el contador y la realidad — la realidad ES el contador.
--   4. increment_pdf_upload se vuelve no-op (lo dejamos por compatibilidad pero
--      ya no se necesita; el conteo es siempre live).
--
-- Robustez añadida:
--   - is_admin envuelto en EXCEPTION → si falla, default a false (no crash).
--   - INSERT de user_subscriptions también con EXCEPTION → si falla, default
--     a {plan: demo, status: trialing} en memoria (no crash).
--   - Cualquier error inesperado retorna can_upload=true con mensaje informativo
--     en vez de explotar — preferimos permitir un upload de más y arreglar
--     después que bloquear al usuario por un bug nuestro.

-- DROP previo: Postgres no deja CREATE OR REPLACE si el return type cambió
-- (SQLSTATE 42P13). Esta migration no había corrido en prod, y la versión
-- vieja en DB devolvía un tipo distinto al actual. Forzamos drop antes.
DROP FUNCTION IF EXISTS public.check_pdf_upload_limit(uuid);

CREATE OR REPLACE FUNCTION public.check_pdf_upload_limit(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_subscription RECORD;
  v_is_admin BOOLEAN := false;
  v_can_upload BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_message TEXT;
  v_plan TEXT;
  v_status TEXT;
BEGIN
  -- Defensa: is_admin puede fallar si user_roles no existe o RLS denies.
  -- Si falla, asumimos false y seguimos.
  BEGIN
    v_is_admin := public.is_admin(p_user_id);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF v_is_admin THEN
    RETURN json_build_object(
      'can_upload', true, 'plan', 'admin', 'limit', -1,
      'used', 0, 'message', '', 'status', 'active', 'is_admin', true
    );
  END IF;

  SELECT * INTO v_subscription FROM user_subscriptions WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    -- Defensa: si el INSERT falla por algún motivo (RLS, schema, etc.), no
    -- crasheamos: asumimos defaults en memoria y dejamos al usuario subir.
    BEGIN
      INSERT INTO user_subscriptions (
        user_id, plan, status, trial_started_at, plan_expires_at,
        pdf_uploads_total, pdf_uploads_this_month
      )
      VALUES (
        p_user_id, 'demo', 'trialing', now(), now() + interval '14 days', 0, 0
      )
      RETURNING * INTO v_subscription;
    EXCEPTION WHEN OTHERS THEN
      -- Defaults seguros en memoria
      v_plan := 'demo';
      v_status := 'trialing';
    END;
  END IF;

  v_plan := COALESCE(v_subscription.plan, v_plan, 'demo');
  v_status := COALESCE(v_subscription.status, v_status, 'trialing');

  -- Conteo DINÁMICO: extractos efectivos = procesados, no borrados, con
  -- al menos una transacción asociada. Esto es lo que el cliente realmente
  -- está "consumiendo".
  SELECT COUNT(DISTINCT bs.id)::INTEGER INTO v_used
  FROM public.bank_statements bs
  WHERE bs.user_id = p_user_id
    AND bs.processed = true
    AND bs.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.statement_id = bs.id AND t.deleted_at IS NULL
    );

  v_used := COALESCE(v_used, 0);

  -- Trial expirado: bloquear
  IF v_plan = 'demo' AND v_status = 'inactive' THEN
    RETURN json_build_object(
      'can_upload', false, 'plan', v_plan, 'limit', 0, 'used', v_used,
      'message', 'Tu prueba gratuita terminó. Activa tu plan para seguir subiendo extractos.',
      'status', v_status, 'is_admin', false
    );
  END IF;

  CASE v_plan
    WHEN 'demo' THEN
      -- Trial activo (trialing): ilimitado durante 14 días.
      v_limit := -1;
      v_can_upload := true;
      v_message := '';
    WHEN 'basico' THEN
      v_limit := 10;
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Alcanzaste el límite de 10 extractos efectivos en tu plan Básico. '
                  || 'Borrá un extracto que no necesités o activá Empresarial.';
      ELSE
        v_message := '';
      END IF;
    WHEN 'pro', 'empresarial' THEN
      v_limit := -1;
      v_can_upload := true;
      v_message := '';
    ELSE
      -- Cualquier otro plan / valor inesperado: por seguridad, permitimos.
      v_limit := -1;
      v_can_upload := true;
      v_message := '';
  END CASE;

  RETURN json_build_object(
    'can_upload', v_can_upload, 'plan', v_plan, 'limit', v_limit,
    'used', v_used, 'message', COALESCE(v_message, ''),
    'status', v_status, 'is_admin', false
  );

EXCEPTION WHEN OTHERS THEN
  -- Última defensa: si algo absolutamente inesperado falla, NO bloqueamos
  -- al usuario. Preferimos un upload de más que un cliente bloqueado en demo.
  RETURN json_build_object(
    'can_upload', true,
    'plan', 'demo',
    'limit', -1,
    'used', 0,
    'message', '',
    'status', 'trialing',
    'is_admin', false,
    'fallback', SQLERRM
  );
END;
$function$;

-- increment_pdf_upload: ya no necesario (el conteo es dinámico).
-- Lo dejamos como no-op para mantener compatibilidad con código existente
-- que lo invoca en parse-bancolombia-pdf y PDFUploader. Cuando esos call
-- sites se limpien, podemos eliminar la función.
-- DROP previo por la misma razón que arriba (cambio de return type).
DROP FUNCTION IF EXISTS public.increment_pdf_upload(uuid);

CREATE OR REPLACE FUNCTION public.increment_pdf_upload(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- No-op intencional. El conteo se hace dinámicamente en
  -- check_pdf_upload_limit desde bank_statements.
  -- p_user_id se usa para que el linter no marque parámetro sin uso.
  PERFORM p_user_id;
END;
$function$;
