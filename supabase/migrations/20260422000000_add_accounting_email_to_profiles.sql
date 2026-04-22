-- Add accounting_email to profiles so each user can save a default accountant
-- email for the "Send export by email" feature. Used when no 'contadora'
-- collaborator is configured, or when the user wants to send to a different
-- address than the collaborator.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accounting_email TEXT;

COMMENT ON COLUMN public.profiles.accounting_email IS
  'Preferred accountant email for export delivery. Used as default recipient when no active contadora collaborator exists.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
