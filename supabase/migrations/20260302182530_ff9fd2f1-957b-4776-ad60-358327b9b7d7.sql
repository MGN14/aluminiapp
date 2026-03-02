
-- Indexes for performance on invoice queries
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date_type ON public.invoices (issue_date, type);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_reference ON public.invoice_items (reference);
