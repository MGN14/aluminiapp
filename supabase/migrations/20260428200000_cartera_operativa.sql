-- Cartera Operativa (Módulo Gerencial, solo admin)
-- Deudas registradas manualmente por el admin que no necesariamente están facturadas a DIAN.
-- Se reducen automáticamente con (a) cash_movements de tipo ingreso vinculados al cliente,
-- (b) transactions bancarias asignadas explícitamente a cartera operativa del cliente.
-- Migration aditiva: no toca datos existentes, todas las columnas nuevas tienen default seguro.

-- ============================================================================
-- 1. Tabla operative_receivables (deudas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.operative_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsible_id uuid NOT NULL REFERENCES public.responsibles(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operative_receivables_user_id_idx
  ON public.operative_receivables(user_id);
CREATE INDEX IF NOT EXISTS operative_receivables_user_responsible_idx
  ON public.operative_receivables(user_id, responsible_id);

COMMENT ON TABLE public.operative_receivables IS 'Cartera Operativa: deudas no necesariamente facturadas a DIAN, registradas manualmente por el admin desde Modulo Gerencial.';

-- ============================================================================
-- 2. RLS strict (owner-only)
-- ============================================================================
ALTER TABLE public.operative_receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operative_receivables_owner_select" ON public.operative_receivables;
CREATE POLICY "operative_receivables_owner_select"
  ON public.operative_receivables FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "operative_receivables_owner_insert" ON public.operative_receivables;
CREATE POLICY "operative_receivables_owner_insert"
  ON public.operative_receivables FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "operative_receivables_owner_update" ON public.operative_receivables;
CREATE POLICY "operative_receivables_owner_update"
  ON public.operative_receivables FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "operative_receivables_owner_delete" ON public.operative_receivables;
CREATE POLICY "operative_receivables_owner_delete"
  ON public.operative_receivables FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 3. Trigger updated_at (reusa función existente)
-- ============================================================================
DROP TRIGGER IF EXISTS set_operative_receivables_updated_at ON public.operative_receivables;
CREATE TRIGGER set_operative_receivables_updated_at
  BEFORE UPDATE ON public.operative_receivables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 4. Extender cash_movements: vincular a cliente
-- ============================================================================
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS responsible_id uuid REFERENCES public.responsibles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_movements_responsible_idx
  ON public.cash_movements(user_id, responsible_id)
  WHERE responsible_id IS NOT NULL;

COMMENT ON COLUMN public.cash_movements.responsible_id IS 'Cliente/responsible vinculado. Si presente y type=ingreso, resta de cartera operativa del cliente.';

-- ============================================================================
-- 5. Extender transactions: marcar pagos bancarios asignados a cartera operativa
-- ============================================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS operative_receivable_assigned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS transactions_operative_assigned_idx
  ON public.transactions(user_id, responsible_id)
  WHERE operative_receivable_assigned = true;

COMMENT ON COLUMN public.transactions.operative_receivable_assigned IS 'true cuando este pago bancario se asigna explicitamente a cartera operativa del responsible. Excluyente con invoice_id (no debe coexistir).';
