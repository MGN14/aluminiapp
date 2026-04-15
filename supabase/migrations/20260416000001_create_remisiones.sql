-- Tabla principal de remisiones
CREATE TABLE IF NOT EXISTS remisiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  date date NOT NULL,
  number text NOT NULL,
  beneficiary text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'despachado', 'cancelado')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE remisiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own remisiones"
  ON remisiones FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tabla de items de cada remision
CREATE TABLE IF NOT EXISTS remision_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remision_id uuid REFERENCES remisiones(id) ON DELETE CASCADE NOT NULL,
  reference text NOT NULL,
  product_name text NOT NULL,
  units numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric GENERATED ALWAYS AS (units * unit_cost) STORED,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE remision_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their remision items"
  ON remision_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM remisiones r
      WHERE r.id = remision_items.remision_id
      AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM remisiones r
      WHERE r.id = remision_items.remision_id
      AND r.user_id = auth.uid()
    )
  );
