CREATE TABLE IF NOT EXISTS product_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  ref_siigo text NOT NULL,
  description text NOT NULL,
  ref_local text,
  ref_proveedor_a text,
  ref_proveedor_b text,
  ref_proveedor_c text,
  unit text NOT NULL DEFAULT 'und',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE product_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their product master"
  ON product_master FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_master_ref_siigo_user
  ON product_master(user_id, ref_siigo);
