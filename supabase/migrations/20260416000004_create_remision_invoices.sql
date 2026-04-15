CREATE TABLE IF NOT EXISTS remision_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remision_id uuid REFERENCES remisiones(id) ON DELETE CASCADE NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(remision_id, invoice_id)
);

ALTER TABLE remision_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their remision_invoices"
  ON remision_invoices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
