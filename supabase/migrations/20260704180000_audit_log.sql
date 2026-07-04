-- Auditoría de cambios (punto 5 del gap ERP): quién cambió qué y cuándo,
-- en las tablas sensibles. Trigger genérico AFTER UPDATE/DELETE que guarda
-- SOLO los campos que cambiaron (diff jsonb), no la fila entera.
-- INSERT no se audita (el created_at + RLS ya cuentan esa historia) para
-- no duplicar cada import de extracto.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,                -- quién hizo el cambio (auth.uid(); null = sistema/trigger)
  owner_id uuid,               -- dueño del dato (para RLS)
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('UPDATE', 'DELETE')),
  -- Solo campos con valor distinto: { campo: { old: ..., new: ... } }
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_owner_idx ON public.audit_log(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_row_idx ON public.audit_log(table_name, row_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_owner_select" ON public.audit_log;
CREATE POLICY "audit_log_owner_select"
  ON public.audit_log FOR SELECT TO authenticated
  USING (owner_id = public.current_data_owner());
-- Sin policies de INSERT/UPDATE/DELETE: solo escribe el trigger (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.tg_audit_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_owner uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_owner := (to_jsonb(OLD) ->> 'user_id')::uuid;
    INSERT INTO public.audit_log (user_id, owner_id, table_name, row_id, action, changes)
    VALUES (auth.uid(), v_owner, TG_TABLE_NAME, (to_jsonb(OLD) ->> 'id')::uuid, 'DELETE', NULL);
    RETURN OLD;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF v_key IN ('updated_at', 'created_at') THEN CONTINUE; END IF;
    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
    END IF;
  END LOOP;
  IF v_changes = '{}'::jsonb THEN RETURN NEW; END IF; -- nada relevante cambió

  v_owner := (v_new ->> 'user_id')::uuid;
  INSERT INTO public.audit_log (user_id, owner_id, table_name, row_id, action, changes)
  VALUES (auth.uid(), v_owner, TG_TABLE_NAME, (v_new ->> 'id')::uuid, 'UPDATE', v_changes);
  RETURN NEW;
END;
$$;

-- Tablas sensibles auditadas
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions', 'invoices', 'imports', 'import_payments',
    'payroll_employees', 'inventory_products', 'reconciliation_rules',
    'production_orders', 'payroll_entries'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_changes ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_changes AFTER UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_audit_changes()',
      t
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.audit_log IS
  'Auditoría de cambios en tablas sensibles: quién (user_id), qué (changes diff old/new por campo), cuándo. Solo UPDATE/DELETE.';
