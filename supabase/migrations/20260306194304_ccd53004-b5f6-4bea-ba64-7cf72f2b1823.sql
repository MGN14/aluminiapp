
-- Table for per-responsible breakdown of CxC, anticipos, CxP
CREATE TABLE public.initial_state_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('cuentas_por_cobrar', 'anticipos_a_proveedores', 'anticipos_de_clientes', 'cuentas_por_pagar')),
  responsible_id UUID REFERENCES public.responsibles(id) ON DELETE SET NULL,
  responsible_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.initial_state_details ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own initial state details"
  ON public.initial_state_details FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own initial state details"
  ON public.initial_state_details FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own initial state details"
  ON public.initial_state_details FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own initial state details"
  ON public.initial_state_details FOR DELETE
  USING (auth.uid() = user_id);
