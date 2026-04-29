-- Caja Menor (Modulo DIAN) + flag is_tax_deductible en categories.
-- El flag de deducibilidad vive en categories y aplica a TODO gasto que use
-- esa categoria: conciliacion bancaria, caja menor, etc. Una sola fuente
-- de verdad. Migration aditiva, sin destruir datos existentes.

-- ============================================================================
-- 1. Tabla petty_cash_movements (Caja Menor)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.petty_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  responsible_id uuid REFERENCES public.responsibles(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  concept text,
  kind text NOT NULL DEFAULT 'gasto_efectivo' CHECK (kind IN ('gasto_efectivo', 'cuenta_de_cobro')),
  numero_cuenta_cobro text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS petty_cash_movements_user_date_idx
  ON public.petty_cash_movements(user_id, date DESC);
CREATE INDEX IF NOT EXISTS petty_cash_movements_responsible_idx
  ON public.petty_cash_movements(user_id, responsible_id)
  WHERE responsible_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS petty_cash_movements_category_idx
  ON public.petty_cash_movements(user_id, category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON TABLE public.petty_cash_movements IS 'Caja Menor (Modulo DIAN): egresos en efectivo del negocio. Solo egresos. Tipos: gasto_efectivo (sin cuenta de cobro) y cuenta_de_cobro (proveedor sin factura electronica).';
COMMENT ON COLUMN public.petty_cash_movements.numero_cuenta_cobro IS 'Numero del documento cuenta de cobro emitido por el proveedor. Solo aplica cuando kind=cuenta_de_cobro.';

-- ============================================================================
-- 2. RLS owner-only
-- ============================================================================
ALTER TABLE public.petty_cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "petty_cash_owner_select" ON public.petty_cash_movements;
CREATE POLICY "petty_cash_owner_select"
  ON public.petty_cash_movements FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "petty_cash_owner_insert" ON public.petty_cash_movements;
CREATE POLICY "petty_cash_owner_insert"
  ON public.petty_cash_movements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "petty_cash_owner_update" ON public.petty_cash_movements;
CREATE POLICY "petty_cash_owner_update"
  ON public.petty_cash_movements FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "petty_cash_owner_delete" ON public.petty_cash_movements;
CREATE POLICY "petty_cash_owner_delete"
  ON public.petty_cash_movements FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 3. Trigger updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS set_petty_cash_updated_at ON public.petty_cash_movements;
CREATE TRIGGER set_petty_cash_updated_at
  BEFORE UPDATE ON public.petty_cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 4. Extender responsibles con NIT y tipo de persona
-- ============================================================================
ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS nit text,
  ADD COLUMN IF NOT EXISTS tipo_persona text CHECK (tipo_persona IN ('natural', 'juridica'));

COMMENT ON COLUMN public.responsibles.nit IS 'NIT del proveedor/cliente. Requerido para cuentas de cobro DIAN.';
COMMENT ON COLUMN public.responsibles.tipo_persona IS 'natural | juridica. Para definir retenciones y deducibilidades segun DIAN.';

-- ============================================================================
-- 5. Extender categories con flag de deducibilidad fiscal
-- ============================================================================
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_tax_deductible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.categories.is_tax_deductible IS 'true si los gastos de esta categoria son deducibles segun DIAN. Aplica a transactions Y petty_cash_movements. Editable por el usuario en Settings.';

-- ============================================================================
-- 6. Pre-cargar flag de deducibilidad en categorias existentes (best effort
--    por nombre comun). Solo marca true las que matchean un set de keywords
--    de gastos clasicamente deducibles. El resto queda en false (default
--    seguro: si no estoy seguro, no es deducible). El usuario puede toggle
--    luego desde Settings.
-- ============================================================================
UPDATE public.categories
SET is_tax_deductible = true
WHERE LOWER(name) ~* ANY (ARRAY[
  'arrendamiento',
  'arriendo',
  'servicios? p[uú]blicos?',
  '\bagua\b',
  '\bluz\b',
  'energ[ií]a',
  'internet',
  'tel[eé]fono',
  'papeler[ií]a',
  '[uú]tiles? de oficina',
  'transporte',
  'flete',
  'honorarios?',
  'mantenimiento',
  'publicidad',
  'mercadeo',
  'gastos? de oficina',
  'comisiones? bancari',
  'salarios?',
  'sueldos?',
  'n[oó]mina',
  'prestaciones',
  'aportes parafiscales',
  '\bica\b',
  'depreciaci[oó]n',
  'amortizaci[oó]n',
  'compra de mercanc',
  'materia prima',
  'mantenimiento veh',
  'combustible'
]);

-- (No hace falta UPDATE explicito a false porque DEFAULT false ya cubre el resto.)
