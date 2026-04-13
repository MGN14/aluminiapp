
-- Business Memory: persistent metrics about each user's business
CREATE TABLE public.business_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  metric_key text NOT NULL,
  metric_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, metric_key)
);

ALTER TABLE public.business_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own business memory"
  ON public.business_memory FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own business memory"
  ON public.business_memory FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own business memory"
  ON public.business_memory FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Business Patterns: detected recurring events
CREATE TABLE public.business_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pattern_type text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount_min numeric NOT NULL DEFAULT 0,
  amount_max numeric NOT NULL DEFAULT 0,
  frequency_days integer NOT NULL DEFAULT 0,
  last_occurrence date,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurrences integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.business_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own patterns"
  ON public.business_patterns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own patterns"
  ON public.business_patterns FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own patterns"
  ON public.business_patterns FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own patterns"
  ON public.business_patterns FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
