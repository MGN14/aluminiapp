
-- Function to link collaborator when user confirms their email (after accepting invite)
CREATE OR REPLACE FUNCTION public.link_collaborator_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only run when email_confirmed_at changes from NULL to a value (user confirmed)
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.collaborators
    SET 
      collaborator_user_id = NEW.id,
      status = 'active',
      accepted_at = now(),
      updated_at = now()
    WHERE 
      collaborator_email = LOWER(NEW.email)
      AND collaborator_user_id IS NULL
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
CREATE TRIGGER on_user_confirmed_link_collaborator
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_collaborator_on_confirm();
