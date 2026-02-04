-- Create contact_messages table to store contact form submissions
CREATE TABLE public.contact_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  replied_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Enable RLS
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public contact form)
CREATE POLICY "Anyone can submit contact messages"
ON public.contact_messages
FOR INSERT
WITH CHECK (true);

-- Only admins can read contact messages
CREATE POLICY "Admins can view contact messages"
ON public.contact_messages
FOR SELECT
USING (public.is_admin(auth.uid()));

-- Only admins can update (mark as read/replied)
CREATE POLICY "Admins can update contact messages"
ON public.contact_messages
FOR UPDATE
USING (public.is_admin(auth.uid()));