-- Add Wompi-specific columns to user_subscriptions
ALTER TABLE public.user_subscriptions 
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wompi_transaction_id text DEFAULT NULL;

-- Drop old Stripe columns (no longer needed)
ALTER TABLE public.user_subscriptions 
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;

-- Create function to expire plans automatically
CREATE OR REPLACE FUNCTION public.expire_plans()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.user_subscriptions
  SET 
    plan = 'demo',
    status = 'active',
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
$$;