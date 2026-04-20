-- Remove the 3-PDF cap on the free (demo/trialing) tier so users can accumulate
-- as much data as possible during the trial. Trial 14-day expiration still applies.
CREATE OR REPLACE FUNCTION public.check_pdf_upload_limit(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_subscription RECORD;
  v_is_admin BOOLEAN;
  v_can_upload BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_message TEXT;
  v_plan TEXT;
  v_status TEXT;
BEGIN
  v_is_admin := public.is_admin(p_user_id);

  IF v_is_admin THEN
    SELECT * INTO v_subscription FROM user_subscriptions WHERE user_id = p_user_id;
    RETURN json_build_object(
      'can_upload', true, 'plan', 'admin', 'limit', -1,
      'used', COALESCE(v_subscription.pdf_uploads_this_month, 0),
      'message', '', 'status', 'active', 'is_admin', true
    );
  END IF;

  SELECT * INTO v_subscription FROM user_subscriptions WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO user_subscriptions (user_id, plan, status, trial_started_at, plan_expires_at, pdf_uploads_total, pdf_uploads_this_month)
    VALUES (p_user_id, 'demo', 'trialing', now(), now() + interval '14 days', 0, 0)
    RETURNING * INTO v_subscription;
  END IF;

  v_plan := v_subscription.plan;
  v_status := v_subscription.status;

  -- If trial expired, block uploads
  IF v_plan = 'demo' AND v_status = 'inactive' THEN
    RETURN json_build_object(
      'can_upload', false, 'plan', v_plan, 'limit', 0, 'used', 0,
      'message', 'Tu prueba gratuita terminó. Activa tu plan para seguir subiendo extractos.',
      'status', v_status, 'is_admin', false
    );
  END IF;

  CASE v_plan
    WHEN 'demo' THEN
      -- Trial: unlimited extractos (the more info, the stickier)
      v_limit := -1;
      v_used := COALESCE(v_subscription.pdf_uploads_total, 0);
      v_can_upload := true;
      v_message := '';
    WHEN 'basico' THEN
      v_limit := 10;
      v_used := COALESCE(v_subscription.pdf_uploads_this_month, 0);
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Alcanzaste el límite de 10 PDFs este mes.';
      END IF;
    WHEN 'pro', 'empresarial' THEN
      v_limit := -1;
      v_used := COALESCE(v_subscription.pdf_uploads_this_month, 0);
      v_can_upload := true;
      v_message := '';
    ELSE
      v_limit := -1;
      v_used := COALESCE(v_subscription.pdf_uploads_total, 0);
      v_can_upload := true;
      v_message := '';
  END CASE;

  RETURN json_build_object(
    'can_upload', v_can_upload, 'plan', v_plan, 'limit', v_limit,
    'used', v_used, 'message', COALESCE(v_message, ''),
    'status', v_status, 'is_admin', false
  );
END;
$function$;
