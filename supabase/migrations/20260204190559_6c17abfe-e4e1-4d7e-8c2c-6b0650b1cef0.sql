-- Update increment_pdf_upload to handle admins (skip limit check for admins but still track usage)
CREATE OR REPLACE FUNCTION public.increment_pdf_upload(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check JSON;
  v_is_admin BOOLEAN;
BEGIN
  -- Check if user is admin (admins always succeed but we still track their usage)
  v_is_admin := public.is_admin(p_user_id);
  
  IF v_is_admin THEN
    -- For admins, just increment counters (no limit check)
    UPDATE public.user_subscriptions
    SET 
      pdf_uploads_this_month = pdf_uploads_this_month + 1,
      pdf_uploads_total = pdf_uploads_total + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
    
    RETURN true;
  END IF;
  
  -- For regular users, check limit first
  v_check := public.check_pdf_upload_limit(p_user_id);
  
  IF NOT (v_check->>'can_upload')::boolean THEN
    RETURN false;
  END IF;
  
  -- Increment counters
  UPDATE public.user_subscriptions
  SET 
    pdf_uploads_this_month = pdf_uploads_this_month + 1,
    pdf_uploads_total = pdf_uploads_total + 1,
    updated_at = now()
  WHERE user_id = p_user_id;
  
  RETURN true;
END;
$$;