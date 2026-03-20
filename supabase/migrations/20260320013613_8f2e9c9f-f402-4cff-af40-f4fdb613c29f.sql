ALTER TABLE public.invoices 
  ADD COLUMN retefuente_cliente_rate numeric DEFAULT 0,
  ADD COLUMN retefuente_cliente_amount numeric DEFAULT 0;