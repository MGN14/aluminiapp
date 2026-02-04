-- Add company_initial column for avatar display
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS company_initial VARCHAR(1) DEFAULT NULL;