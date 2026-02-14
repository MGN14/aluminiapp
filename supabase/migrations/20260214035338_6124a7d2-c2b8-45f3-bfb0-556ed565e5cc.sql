
-- Remove the existing UPDATE policy if it exists (from previous attempt or otherwise)
DROP POLICY IF EXISTS "Users can update their own subscription" ON public.user_subscriptions;

-- Explicitly ensure NO update policy exists for authenticated users
-- The webhook uses service_role which bypasses RLS entirely, so this is safe.

-- Also remove any DELETE policy to prevent users from deleting their subscription
DROP POLICY IF EXISTS "Users can delete their own subscription" ON public.user_subscriptions;

-- Add a comment documenting the security model
COMMENT ON TABLE public.user_subscriptions IS 'Subscription data is read-only for users. Only the Wompi webhook (via service_role) can modify plan, status, and expiration fields.';
