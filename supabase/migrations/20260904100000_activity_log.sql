-- Historial de actividad del equipo (Nico 2026-09-04): "necesito en el
-- dashboard un historial de cambios por parte de los colaboradores donde
-- diga hora exacta, cambio y quién lo hizo. Ej: Lina agregó a las 5pm del
-- viernes la remisión de Yenny Molano".
--
-- Diseño:
--   · Triggers AFTER en remisiones e invoices (las entidades que tocan los
--     colaboradores). Fácil extender a más tablas con un CREATE TRIGGER.
--   · SOLO acciones humanas: si auth.uid() es NULL (service_role: sync de
--     Siigo, buzón de facturas, crons) NO se loguea — sin eso el sync
--     inundaría el historial con cientos de filas "sistema".
--   · Updates que solo tocan updated_at (triggers de la casa) se ignoran.
--   · RLS: SOLO el dueño de los datos lee el historial (auth.uid() = user_id
--     estricto, sin current_data_owner) — es supervisión del equipo, los
--     colaboradores no lo ven. Nadie escribe por API: solo los triggers
--     (SECURITY DEFINER).
--   · El log arranca DESDE que se aplica esta migración (no hay retroactivo).

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,          -- dueño de los datos (a quién le reportan)
  actor_id uuid NULL,             -- quién lo hizo (auth.uid real del click)
  actor_email text NULL,
  action text NOT NULL CHECK (action IN ('creo', 'edito', 'elimino')),
  entity_type text NOT NULL,      -- 'remision' | 'factura'
  entity_id uuid NULL,
  entity_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_owner_time_idx
  ON public.activity_log(user_id, created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_owner_select ON public.activity_log;
CREATE POLICY activity_log_owner_select ON public.activity_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- Sin policies de INSERT/UPDATE/DELETE: por API nadie escribe ni borra.

CREATE OR REPLACE FUNCTION public.log_entity_activity() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  j jsonb;
  v_label text;
  v_email text;
  v_type text;
BEGIN
  -- Solo acciones humanas: los procesos con service_role no ensucian el log.
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    j := to_jsonb(OLD);
    v_action := 'elimino';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Cambios de solo-updated_at (triggers de la casa) no son actividad.
    IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
      RETURN NULL;
    END IF;
    j := to_jsonb(NEW);
    v_action := 'edito';
  ELSE
    j := to_jsonb(NEW);
    v_action := 'creo';
  END IF;

  IF j->>'user_id' IS NULL THEN
    RETURN NULL;
  END IF;

  v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';

  v_label := CASE TG_TABLE_NAME
    WHEN 'remisiones' THEN
      coalesce(j->>'number', '')
      || CASE WHEN coalesce(j->>'beneficiary', '') <> '' THEN ' · ' || (j->>'beneficiary') ELSE '' END
    WHEN 'invoices' THEN
      (CASE WHEN j->>'type' = 'venta' THEN 'FV' ELSE 'FC' END)
      || coalesce('-' || nullif(j->>'invoice_number', ''), '')
      || CASE WHEN coalesce(j->>'counterparty_name', '') <> '' THEN ' · ' || (j->>'counterparty_name') ELSE '' END
    ELSE TG_TABLE_NAME
  END;

  v_type := CASE TG_TABLE_NAME
    WHEN 'remisiones' THEN 'remision'
    WHEN 'invoices' THEN 'factura'
    ELSE TG_TABLE_NAME
  END;

  INSERT INTO public.activity_log (user_id, actor_id, actor_email, action, entity_type, entity_id, entity_label)
  VALUES ((j->>'user_id')::uuid, auth.uid(), v_email, v_action, v_type, (j->>'id')::uuid, left(coalesce(v_label, ''), 140));

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_activity_remisiones ON public.remisiones;
CREATE TRIGGER log_activity_remisiones
  AFTER INSERT OR UPDATE OR DELETE ON public.remisiones
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_activity();

DROP TRIGGER IF EXISTS log_activity_invoices ON public.invoices;
CREATE TRIGGER log_activity_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.log_entity_activity();

COMMENT ON TABLE public.activity_log IS
  'Historial de acciones humanas sobre remisiones/facturas (triggers log_entity_activity). Solo lo lee el dueño de los datos. Extender = un CREATE TRIGGER más.';

NOTIFY pgrst, 'reload schema';
