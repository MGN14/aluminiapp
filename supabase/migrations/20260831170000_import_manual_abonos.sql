-- Abonos MANUALES del tablero Escenarios ("abonos no reales" — Nico, 2026-08-31).
--
-- Plata que Nico sabe que se movió pero que NO está (o no estará) en la
-- contabilidad de la app: giros de terceros (Mauricio), compras de dólares
-- aún no conciliadas, apartados de palabra. Viven SOLO en este tablero:
--   · NO son import_payments (esos son los reales, conectados al banco, y se
--     administran en la pestaña Pedidos).
--   · NO tocan transactions ni ningún reporte contable.
--   · El tablero los suma al saldo con etiqueta propia, para que el número
--     de decisión sea el real-real aunque el papeleo venga atrás.
--
-- USD no se guarda: se deriva COP ÷ TRM (como en el calculador HTML).

CREATE TABLE IF NOT EXISTS public.import_manual_abonos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  descripcion text NOT NULL DEFAULT '',
  cop numeric(18, 2) NOT NULL CHECK (cop > 0),
  trm numeric(12, 4) NOT NULL CHECK (trm > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_manual_abonos_import
  ON public.import_manual_abonos(import_id, fecha);

ALTER TABLE public.import_manual_abonos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_abonos_all" ON public.import_manual_abonos;
CREATE POLICY "manual_abonos_all" ON public.import_manual_abonos
  FOR ALL TO authenticated
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.import_manual_abonos;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.import_manual_abonos
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

COMMENT ON TABLE public.import_manual_abonos IS
  'Abonos manuales del tablero Escenarios de Importaciones — NO contables, NO conectados a banco. Los abonos reales viven en import_payments.';

NOTIFY pgrst, 'reload schema';
