-- Create enum for subscription plans
CREATE TYPE public.subscription_plan AS ENUM ('demo', 'basico', 'empresarial');

-- Create enum for subscription status
CREATE TYPE public.subscription_status AS ENUM ('active', 'canceled', 'past_due', 'trialing', 'inactive');

-- Create user_subscriptions table
CREATE TABLE public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  plan subscription_plan NOT NULL DEFAULT 'demo',
  status subscription_status NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  pdf_uploads_this_month INTEGER NOT NULL DEFAULT 0,
  pdf_uploads_total INTEGER NOT NULL DEFAULT 0,
  bank_accounts_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own subscription"
ON public.user_subscriptions
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscription"
ON public.user_subscriptions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Only backend can update subscriptions (via service role)
CREATE POLICY "Service role can update subscriptions"
ON public.user_subscriptions
FOR UPDATE
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_user_subscriptions_updated_at
BEFORE UPDATE ON public.user_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check PDF upload limits
CREATE OR REPLACE FUNCTION public.check_pdf_upload_limit(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription RECORD;
  v_can_upload BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_message TEXT;
BEGIN
  -- Get user subscription or create demo if not exists
  SELECT * INTO v_subscription
  FROM public.user_subscriptions
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    -- Create demo subscription for new user
    INSERT INTO public.user_subscriptions (user_id, plan, status)
    VALUES (p_user_id, 'demo', 'active')
    RETURNING * INTO v_subscription;
  END IF;
  
  -- Check limits based on plan
  CASE v_subscription.plan
    WHEN 'demo' THEN
      v_limit := 1;
      v_used := v_subscription.pdf_uploads_total;
      v_can_upload := v_used < v_limit;
      v_message := 'Ya usaste el extracto gratuito. Para seguir usando AluminIA, suscríbete al plan Básico.';
    WHEN 'basico' THEN
      v_limit := 10;
      v_used := v_subscription.pdf_uploads_this_month;
      v_can_upload := v_used < v_limit;
      v_message := 'Has alcanzado el límite de 10 PDFs este mes. Actualiza al plan Empresarial para continuar.';
    WHEN 'empresarial' THEN
      v_limit := -1; -- unlimited
      v_used := v_subscription.pdf_uploads_this_month;
      v_can_upload := true;
      v_message := '';
  END CASE;
  
  RETURN json_build_object(
    'can_upload', v_can_upload,
    'plan', v_subscription.plan,
    'limit', v_limit,
    'used', v_used,
    'message', v_message,
    'status', v_subscription.status
  );
END;
$$;

-- Function to increment PDF upload count
CREATE OR REPLACE FUNCTION public.increment_pdf_upload(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check JSON;
BEGIN
  -- First check if user can upload
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

-- Function to reset monthly PDF count (to be called by cron)
CREATE OR REPLACE FUNCTION public.reset_monthly_pdf_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_subscriptions
  SET pdf_uploads_this_month = 0
  WHERE plan IN ('basico', 'empresarial');
END;
$$;

-- Create auto-subscription for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'demo', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger to auto-create subscription on new user
CREATE TRIGGER on_auth_user_created_subscription
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_subscription();