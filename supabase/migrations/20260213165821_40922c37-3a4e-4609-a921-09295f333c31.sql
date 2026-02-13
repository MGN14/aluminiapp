-- Fix RLS "always true" on contact_messages
DROP POLICY IF EXISTS "Anyone can submit contact messages" ON public.contact_messages;

CREATE POLICY "Anyone can submit contact messages"
ON public.contact_messages
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(name) > 0 AND length(email) > 0 AND length(message) > 0
);