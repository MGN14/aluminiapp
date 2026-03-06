
-- Create initial financial state table
CREATE TABLE public.initial_financial_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  fecha_inicio date NOT NULL,
  -- Activos
  saldo_bancos numeric NOT NULL DEFAULT 0,
  cuentas_por_cobrar numeric NOT NULL DEFAULT 0,
  inventario numeric NOT NULL DEFAULT 0,
  anticipos_a_proveedores numeric NOT NULL DEFAULT 0,
  otros_activos numeric NOT NULL DEFAULT 0,
  -- Pasivos
  cuentas_por_pagar numeric NOT NULL DEFAULT 0,
  anticipos_de_clientes numeric NOT NULL DEFAULT 0,
  impuestos_por_pagar numeric NOT NULL DEFAULT 0,
  prestamos numeric NOT NULL DEFAULT 0,
  -- Impuestos
  iva_a_favor numeric NOT NULL DEFAULT 0,
  iva_por_pagar numeric NOT NULL DEFAULT 0,
  retefuente_por_pagar numeric NOT NULL DEFAULT 0,
  ica_por_pagar numeric NOT NULL DEFAULT 0,
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.initial_financial_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own initial state"
  ON public.initial_financial_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own initial state"
  ON public.initial_financial_state FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own initial state"
  ON public.initial_financial_state FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
