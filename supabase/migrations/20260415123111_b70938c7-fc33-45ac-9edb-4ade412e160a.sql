
-- Create remisiones table
CREATE TABLE public.remisiones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  number TEXT NOT NULL DEFAULT '',
  beneficiary TEXT NOT NULL DEFAULT '',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.remisiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own remisiones" ON public.remisiones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own remisiones" ON public.remisiones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own remisiones" ON public.remisiones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own remisiones" ON public.remisiones FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_remisiones_updated_at BEFORE UPDATE ON public.remisiones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create remision_items table
CREATE TABLE public.remision_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  remision_id UUID NOT NULL REFERENCES public.remisiones(id) ON DELETE CASCADE,
  reference TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  units NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.remision_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own remision items" ON public.remision_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.remisiones r WHERE r.id = remision_items.remision_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can insert their own remision items" ON public.remision_items FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.remisiones r WHERE r.id = remision_items.remision_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can update their own remision items" ON public.remision_items FOR UPDATE USING (EXISTS (SELECT 1 FROM public.remisiones r WHERE r.id = remision_items.remision_id AND r.user_id = auth.uid()));
CREATE POLICY "Users can delete their own remision items" ON public.remision_items FOR DELETE USING (EXISTS (SELECT 1 FROM public.remisiones r WHERE r.id = remision_items.remision_id AND r.user_id = auth.uid()));
