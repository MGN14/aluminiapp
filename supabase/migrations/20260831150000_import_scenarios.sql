-- F4 pestaña Escenarios: guardar un escenario con nombre para volver a él
-- y CONFRONTARLO contra la realidad cuando el contenedor cierre.
--
-- Un escenario guardado es una foto de las tres perillas (TRM/SMM/flete) más
-- el snapshot de lo que daban en ese momento (caja para cerrar, total del
-- siguiente, etc.). Al listar, si el pedido vigente de ese escenario ya
-- cerró, la UI compara la TRM asumida contra la TRM ponderada real de los
-- abonos — el mismo espíritu del libro de aciertos, calculado en vivo.
--
-- Regla de la pestaña: LO REAL, aparte de la contabilidad. Esta tabla no se
-- mezcla con imports/import_costs/import_payments — es una libreta de
-- decisiones, no un registro contable.

CREATE TABLE IF NOT EXISTS public.import_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  -- Las tres perillas tal como quedaron (null = se usó el valor del día).
  trm numeric(12, 4) NULL,
  smm_usd_ton numeric(12, 2) NULL,
  flete_usd numeric(12, 2) NULL,
  -- Pedido vigente al que apuntaba el escenario (para confrontar al cierre).
  import_id uuid NULL REFERENCES public.imports(id) ON DELETE SET NULL,
  -- Foto de resultados al guardar: {trmHoy, vigente:{saldoUsd, saldoCop,
  -- cajaParaCerrar, arancel, iva}, siguiente:{totalCop, copPorKg,
  -- mercanciaUsd, llegada}}. JSON plano — nada de Maps (regla de la casa).
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notas text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_scenarios_user
  ON public.import_scenarios(user_id, created_at DESC);

ALTER TABLE public.import_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_scenarios_select" ON public.import_scenarios;
CREATE POLICY "import_scenarios_select" ON public.import_scenarios
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "import_scenarios_insert" ON public.import_scenarios;
CREATE POLICY "import_scenarios_insert" ON public.import_scenarios
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "import_scenarios_delete" ON public.import_scenarios;
CREATE POLICY "import_scenarios_delete" ON public.import_scenarios
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.import_scenarios;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.import_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

NOTIFY pgrst, 'reload schema';
