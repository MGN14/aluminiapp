-- Segmentación de clientes en Remisiones: MAYORISTAS vs FABRICANTES.
--
-- Pedido de Nico (2026-07-29): "hay muchas remisiones pequeñas como las de
-- Vidrios Soto (fabricante chico) que ensucian los números de los mayoristas
-- — quiero pestañas separadas, cada una con sus KPIs".
--
-- Llave = nombre del beneficiario normalizado (las remisiones viejas no
-- siempre tienen responsible_id; el beneficiario texto es lo que siempre hay).

CREATE TABLE IF NOT EXISTS public.beneficiary_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  beneficiary_norm text NOT NULL,
  segment text NOT NULL CHECK (segment IN ('mayorista', 'fabricante')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, beneficiary_norm)
);

ALTER TABLE public.beneficiary_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "beneficiary_segments_select" ON public.beneficiary_segments;
CREATE POLICY "beneficiary_segments_select"
  ON public.beneficiary_segments FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "beneficiary_segments_insert" ON public.beneficiary_segments;
CREATE POLICY "beneficiary_segments_insert"
  ON public.beneficiary_segments FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "beneficiary_segments_update" ON public.beneficiary_segments;
CREATE POLICY "beneficiary_segments_update"
  ON public.beneficiary_segments FOR UPDATE TO authenticated
  USING (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "beneficiary_segments_delete" ON public.beneficiary_segments;
CREATE POLICY "beneficiary_segments_delete"
  ON public.beneficiary_segments FOR DELETE TO authenticated
  USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_beneficiary_segments_user_id ON public.beneficiary_segments;
CREATE TRIGGER set_beneficiary_segments_user_id
  BEFORE INSERT ON public.beneficiary_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

COMMENT ON TABLE public.beneficiary_segments IS
  'Clasificación de clientes de remisiones: mayorista o fabricante, por nombre de beneficiario normalizado (lower/trim).';
