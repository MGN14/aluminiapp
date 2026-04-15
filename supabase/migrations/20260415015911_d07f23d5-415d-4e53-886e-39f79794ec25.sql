
CREATE TABLE public.cash_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  date date NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  description text NOT NULL,
  category text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cash movements"
  ON public.cash_movements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cash movements"
  ON public.cash_movements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cash movements"
  ON public.cash_movements FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own cash movements"
  ON public.cash_movements FOR UPDATE
  USING (auth.uid() = user_id);
