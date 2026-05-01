-- Fix: drop dangerous UPDATE policy on user_subscriptions.
-- Original policy used `USING (true)` with comment "Service role can update subscriptions",
-- but service_role bypasses RLS by default — the policy was unnecessary AND it allowed
-- any authenticated user to UPDATE any row (including upgrading their own plan or
-- mutating other users' subscriptions).
--
-- Drop without replacement: writes happen via:
--   - service_role from edge functions (bypasses RLS)
--   - SECURITY DEFINER functions: increment_pdf_upload, handle_new_user_subscription,
--     reset_monthly_pdf_counts (all bypass RLS via SECURITY DEFINER)

DROP POLICY IF EXISTS "Service role can update subscriptions" ON public.user_subscriptions;

NOTIFY pgrst, 'reload schema';
