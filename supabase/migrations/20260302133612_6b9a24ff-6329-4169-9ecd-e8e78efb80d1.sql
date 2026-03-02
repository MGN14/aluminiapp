
-- Add trial tracking columns to user_subscriptions
ALTER TABLE public.user_subscriptions 
  ADD COLUMN IF NOT EXISTS trial_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS trial_checklist jsonb DEFAULT '{"statement_uploaded": false, "invoice_uploaded": false, "invoice_matched": false, "dian_reviewed": false}'::jsonb;

-- Update handle_new_user_subscription to auto-set trial
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_subscriptions (
    user_id, plan, status, trial_started_at, plan_expires_at, trial_checklist
  )
  VALUES (
    NEW.id, 
    'demo', 
    'trialing',
    now(),
    now() + interval '14 days',
    '{"statement_uploaded": false, "invoice_uploaded": false, "invoice_matched": false, "dian_reviewed": false}'::jsonb
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Update expire_plans to handle trial expiration (set status to 'inactive' instead of reverting plan)
CREATE OR REPLACE FUNCTION public.expire_plans()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Expire trial plans (demo with trialing status) -> set to inactive
  UPDATE public.user_subscriptions
  SET 
    status = 'inactive',
    updated_at = now()
  WHERE 
    plan = 'demo'
    AND status = 'trialing'
    AND plan_expires_at IS NOT NULL
    AND plan_expires_at < now()
    AND user_id NOT IN (
      SELECT user_id FROM public.user_roles WHERE role = 'admin'
    );

  -- Expire paid plans -> revert to demo inactive
  UPDATE public.user_subscriptions
  SET 
    plan = 'demo',
    status = 'inactive',
    plan_expires_at = NULL,
    wompi_transaction_id = NULL,
    updated_at = now()
  WHERE 
    plan != 'demo'
    AND plan_expires_at IS NOT NULL
    AND plan_expires_at < now()
    AND user_id NOT IN (
      SELECT user_id FROM public.user_roles WHERE role = 'admin'
    );
END;
$function$;

-- Update check_pdf_upload_limit for trial plan (3 extractos max)
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
      -- Trial: max 3 extractos total
      v_limit := 3;
      v_used := COALESCE(v_subscription.pdf_uploads_total, 0);
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Alcanzaste el límite de 3 extractos en tu prueba gratuita. Activa tu plan para subir más.';
      END IF;
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
      v_limit := 3;
      v_used := COALESCE(v_subscription.pdf_uploads_total, 0);
      v_can_upload := v_used < v_limit;
      v_message := 'Plan no reconocido.';
  END CASE;
  
  RETURN json_build_object(
    'can_upload', v_can_upload, 'plan', v_plan, 'limit', v_limit,
    'used', v_used, 'message', COALESCE(v_message, ''),
    'status', v_status, 'is_admin', false
  );
END;
$function$;

-- Function to clean up data 30 days after trial expiration
CREATE OR REPLACE FUNCTION public.cleanup_expired_trial_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
BEGIN
  -- Find users whose trial expired more than 30 days ago and have no paid plan
  FOR v_user IN
    SELECT user_id FROM public.user_subscriptions
    WHERE plan = 'demo'
      AND status = 'inactive'
      AND plan_expires_at IS NOT NULL
      AND plan_expires_at < now() - interval '30 days'
      AND user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  LOOP
    -- Soft-delete transactions
    UPDATE public.transactions SET deleted_at = now() WHERE user_id = v_user.user_id AND deleted_at IS NULL;
    -- Soft-delete bank statements
    UPDATE public.bank_statements SET deleted_at = now() WHERE user_id = v_user.user_id AND deleted_at IS NULL;
    -- Delete invoices
    DELETE FROM public.invoice_items WHERE user_id = v_user.user_id;
    DELETE FROM public.invoice_transaction_matches WHERE user_id = v_user.user_id;
    DELETE FROM public.invoices WHERE user_id = v_user.user_id;
    -- Reset subscription counters
    UPDATE public.user_subscriptions 
    SET pdf_uploads_total = 0, pdf_uploads_this_month = 0, updated_at = now()
    WHERE user_id = v_user.user_id;
  END LOOP;
END;
$function$;

-- Update existing demo users: set trial_started_at and plan_expires_at if not set
UPDATE public.user_subscriptions
SET 
  trial_started_at = COALESCE(created_at, now()),
  status = CASE 
    WHEN plan_expires_at IS NOT NULL AND plan_expires_at < now() THEN 'inactive'
    WHEN plan = 'demo' THEN 'trialing'
    ELSE status
  END,
  plan_expires_at = CASE
    WHEN plan = 'demo' AND plan_expires_at IS NULL THEN created_at + interval '14 days'
    ELSE plan_expires_at
  END
WHERE plan = 'demo' AND trial_started_at IS NULL;
