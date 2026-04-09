
-- Create enum for collaborator roles
CREATE TYPE public.collaborator_role AS ENUM ('contadora', 'colaborador');

-- Create enum for access levels
CREATE TYPE public.module_access_level AS ENUM ('none', 'view', 'edit');

-- Collaborators table
CREATE TABLE public.collaborators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  collaborator_email TEXT NOT NULL,
  collaborator_user_id UUID NULL,
  role collaborator_role NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  invited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  accepted_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, collaborator_email)
);

ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;

-- Owner can do everything
CREATE POLICY "Owner can view collaborators"
  ON public.collaborators FOR SELECT
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Collaborator can view own record"
  ON public.collaborators FOR SELECT
  USING (auth.uid() = collaborator_user_id);

CREATE POLICY "Owner can insert collaborators"
  ON public.collaborators FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owner can update collaborators"
  ON public.collaborators FOR UPDATE
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Owner can delete collaborators"
  ON public.collaborators FOR DELETE
  USING (auth.uid() = owner_user_id);

-- Collaborator permissions table
CREATE TABLE public.collaborator_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  access_level module_access_level NOT NULL DEFAULT 'none',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(collaborator_id, module_key)
);

ALTER TABLE public.collaborator_permissions ENABLE ROW LEVEL SECURITY;

-- Owner can manage permissions (join through collaborators)
CREATE POLICY "Owner can view permissions"
  ON public.collaborator_permissions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = collaborator_id AND c.owner_user_id = auth.uid()
  ));

CREATE POLICY "Collaborator can view own permissions"
  ON public.collaborator_permissions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = collaborator_id AND c.collaborator_user_id = auth.uid()
  ));

CREATE POLICY "Owner can insert permissions"
  ON public.collaborator_permissions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = collaborator_id AND c.owner_user_id = auth.uid()
  ));

CREATE POLICY "Owner can update permissions"
  ON public.collaborator_permissions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = collaborator_id AND c.owner_user_id = auth.uid()
  ));

CREATE POLICY "Owner can delete permissions"
  ON public.collaborator_permissions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = collaborator_id AND c.owner_user_id = auth.uid()
  ));

-- Trigger to enforce max 3 collaborators per owner (including owner = 1 + 2 collaborators)
CREATE OR REPLACE FUNCTION public.check_collaborator_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.collaborators WHERE owner_user_id = NEW.owner_user_id) >= 2 THEN
    RAISE EXCEPTION 'Maximum of 2 collaborators (3 total users) reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_collaborator_limit
  BEFORE INSERT ON public.collaborators
  FOR EACH ROW
  EXECUTE FUNCTION public.check_collaborator_limit();

-- Updated_at trigger
CREATE TRIGGER update_collaborators_updated_at
  BEFORE UPDATE ON public.collaborators
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collaborator_permissions_updated_at
  BEFORE UPDATE ON public.collaborator_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
