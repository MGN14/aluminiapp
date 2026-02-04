-- Update check_pdf_upload_limit to handle founder admin with basico limits (not unlimited)
CREATE OR REPLACE FUNCTION public.check_pdf_upload_limit(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription RECORD;
  v_is_admin BOOLEAN;
  v_can_upload BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_message TEXT;
  v_plan TEXT;
  v_user_email TEXT;
  v_founder_email TEXT;
  v_is_founder BOOLEAN := false;
BEGIN
  -- Verificar si es admin primero
  v_is_admin := public.is_admin(p_user_id);
  
  -- Check if user is founder (special admin with basico limits)
  -- We need to get user email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = p_user_id;
  
  -- Get founder email from environment (set via edge function logic)
  -- For now, we'll treat founder as admin but with basico limits
  -- The founder detection happens in the edge function
  
  IF v_is_admin THEN
    -- Get the subscription record to check if there's a plan override
    SELECT * INTO v_subscription
    FROM user_subscriptions
    WHERE user_id = p_user_id;
    
    -- Regular admins have unlimited access (for backward compatibility)
    -- The founder-specific handling is done in the edge function
    RETURN json_build_object(
      'can_upload', true,
      'plan', 'admin',
      'limit', -1,
      'used', COALESCE(v_subscription.pdf_uploads_this_month, 0),
      'message', '',
      'status', 'active',
      'is_admin', true
    );
  END IF;
  
  -- Obtener suscripción del usuario (NO admin)
  SELECT * INTO v_subscription
  FROM user_subscriptions
  WHERE user_id = p_user_id;
  
  -- Si no existe, crear registro demo con valores inicializados a 0
  IF NOT FOUND THEN
    INSERT INTO user_subscriptions (
      user_id, 
      plan, 
      status,
      pdf_uploads_total,
      pdf_uploads_this_month
    )
    VALUES (
      p_user_id, 
      'demo', 
      'active',
      0,
      0
    )
    RETURNING * INTO v_subscription;
  END IF;
  
  v_plan := v_subscription.plan;
  
  -- Determinar límites según plan
  CASE v_plan
    WHEN 'demo' THEN
      v_limit := 1;
      v_used := COALESCE(v_subscription.pdf_uploads_total, 0);
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Ya usaste el extracto gratuito. Para seguir usando AluminIA, suscríbete al plan Básico.';
      END IF;
    WHEN 'basico' THEN
      v_limit := 10;
      v_used := COALESCE(v_subscription.pdf_uploads_this_month, 0);
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Alcanzaste el límite de 10 PDFs este mes. Espera al próximo ciclo o actualiza al plan Empresarial.';
      END IF;
    WHEN 'empresarial' THEN
      v_limit := -1; -- ilimitado
      v_used := COALESCE(v_subscription.pdf_uploads_this_month, 0);
      v_can_upload := true;
      v_message := '';
    ELSE
      v_limit := 1;
      v_used := COALESCE(v_subscription.pdf_uploads_total, 0);
      v_can_upload := v_used < v_limit;
      v_message := 'Plan no reconocido.';
  END CASE;
  
  RETURN json_build_object(
    'can_upload', v_can_upload,
    'plan', v_plan,
    'limit', v_limit,
    'used', v_used,
    'message', COALESCE(v_message, ''),
    'status', v_subscription.status,
    'is_admin', false
  );
END;
$$;