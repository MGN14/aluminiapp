
CREATE TABLE public.financial_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  year integer NOT NULL,
  score_total integer NOT NULL DEFAULT 0,
  score_conciliacion integer NOT NULL DEFAULT 0,
  score_facturacion integer NOT NULL DEFAULT 0,
  score_impuestos integer NOT NULL DEFAULT 0,
  score_cartera integer NOT NULL DEFAULT 0,
  score_clasificacion integer NOT NULL DEFAULT 0,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, month, year)
);

ALTER TABLE public.financial_health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scores" ON public.financial_health_scores
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scores" ON public.financial_health_scores
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scores" ON public.financial_health_scores
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
