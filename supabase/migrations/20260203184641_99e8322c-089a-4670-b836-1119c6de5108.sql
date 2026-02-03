-- Drop the overly permissive UPDATE policy
DROP POLICY IF EXISTS "Service role can update subscriptions" ON public.user_subscriptions;

-- Note: Updates will be handled by SECURITY DEFINER functions which bypass RLS
-- This is the secure pattern since only the backend functions can modify subscriptions