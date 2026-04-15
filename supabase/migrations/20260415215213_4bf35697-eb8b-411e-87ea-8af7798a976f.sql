-- Add missing module_origin column to remisiones
ALTER TABLE public.remisiones ADD COLUMN IF NOT EXISTS module_origin TEXT NOT NULL DEFAULT 'dian';

-- Create remision_invoices junction table
CREATE TABLE IF NOT EXISTS public.remision_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remision_id UUID NOT NULL REFERENCES public.remisiones(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(remision_id, invoice_id)
);

ALTER TABLE public.remision_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own remision_invoices"
  ON public.remision_invoices
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());