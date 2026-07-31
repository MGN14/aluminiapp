-- ============================================================================
-- remision_payments: RLS de colaboradores (quedó afuera por un typo)
-- ============================================================================
-- La migración 20260507120000_collaborators_share_owner_data.sql convierte las
-- tablas "categoría A" al modelo user_id = current_data_owner(). Su array las
-- lista por nombre y trae **'remission_payments'** — con doble s. Esa tabla no
-- existe: la real es `remision_payments`. La migración loguea "Skip table
-- remission_payments: not found in public schema" y sigue de largo, así que
-- esta tabla se quedó con la RLS vieja `auth.uid() = user_id` desde abril.
--
-- Consecuencia para un COLABORADOR (Lina):
--   · no ve ninguna fila → no puede consultar qué pagos ya están vinculados;
--   · el guard anti doble-vinculación de VincularPagoRemisionModal se apoya en
--     esa consulta, así que para ella un pago YA vinculado a otra remisión
--     aparece como "disponible" y lo puede volver a vincular;
--   · sus inserts quedaban asociados a su propio user_id en vez del dueño.
--
-- Se corrige con el mismo patrón que usa el resto: policies contra
-- current_data_owner() + el trigger BEFORE INSERT que reescribe user_id.
--
-- Las otras tablas que hoy siguen solo-dueño (imports, payroll, year_closings,
-- expected_payments, income_receipts, conciliación) NO se tocan acá: son de
-- Gerencial / Nómina / Importaciones, módulos que son admin-only por decisión
-- de producto, no por accidente.
-- ============================================================================

DO $$
DECLARE
  pol RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'remision_payments' AND n.nspname = 'public'
  ) THEN
    RAISE NOTICE 'remision_payments no existe — nada que hacer';
    RETURN;
  END IF;

  FOR pol IN
    SELECT polname FROM pg_policy WHERE polrelid = 'public.remision_payments'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.remision_payments', pol.polname);
  END LOOP;
END $$;

CREATE POLICY remision_payments_owner_or_collab_select ON public.remision_payments
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY remision_payments_owner_or_collab_insert ON public.remision_payments
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY remision_payments_owner_or_collab_update ON public.remision_payments
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY remision_payments_owner_or_collab_delete ON public.remision_payments
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

ALTER TABLE public.remision_payments ENABLE ROW LEVEL SECURITY;

-- Safety net: si el frontend manda su propio user_id, el trigger lo reescribe
-- al dueño efectivo antes del WITH CHECK.
DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.remision_payments;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.remision_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

-- Filas que un colaborador insertó con su propio user_id mientras la RLS vieja
-- estaba activa: quedaron huérfanas (el dueño no las ve). Se reasignan al
-- owner que lo invitó. Solo toca filas cuyo user_id ES un colaborador activo.
UPDATE public.remision_payments rp
SET user_id = c.owner_user_id
FROM public.collaborators c
WHERE c.collaborator_user_id = rp.user_id
  AND c.status = 'active';

NOTIFY pgrst, 'reload schema';
