
CREATE TABLE public.nico_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  page_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.nico_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own nico messages"
  ON public.nico_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own nico messages"
  ON public.nico_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own nico messages"
  ON public.nico_messages FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_nico_messages_user_created ON public.nico_messages(user_id, created_at DESC);
