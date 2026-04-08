
CREATE TABLE public.inventory_import_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_errors INTEGER NOT NULL DEFAULT 0,
  import_mode TEXT NOT NULL DEFAULT 'initial',
  error_details JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own import logs"
ON public.inventory_import_logs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own import logs"
ON public.inventory_import_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own import logs"
ON public.inventory_import_logs FOR DELETE
USING (auth.uid() = user_id);
