-- Descripciones EXCLUIDAS del análisis de conciliación (Nico, 2026-08-06):
-- "transferencias, consignaciones, transferencias nequi pueden provenir de
-- cualquier cliente" — el beneficiario varía legítimamente, así que ni
-- alertas, ni sugerencias por descripción, ni reglas sugeridas para ellas.
-- Mismo patrón RLS que reconciliation_rules (owner directo).

CREATE TABLE IF NOT EXISTS public.conciliacion_exclusiones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  desc_normalizada  text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, desc_normalizada)
);

COMMENT ON TABLE public.conciliacion_exclusiones IS
  'Descripciones que el usuario marcó como "no auditar": beneficiario/categoría varían legítimamente (pagos de clientes por transferencia/consignación/Nequi).';

ALTER TABLE public.conciliacion_exclusiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conciliacion_exclusiones_all ON public.conciliacion_exclusiones;
CREATE POLICY conciliacion_exclusiones_all ON public.conciliacion_exclusiones
  FOR ALL USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
