-- Cierre de importación con checklist documental + IVA editable.
--
-- Flujo: cuando el contenedor pasa a 'entregado' se habilita el CIERRE.
-- Para cerrar hay que tener subidos los documentos del checklist:
--   swift             → constancia de cada giro (uno por abono registrado)
--   dim               → Declaración de Importación (aduana)
--   certificado_banrep→ excel de legalización de pagos frente a Banco de la
--                       República (se sube a Bancolombia por cada pago; acá
--                       basta UNO como evidencia de que se envió)
--   costeo_excel      → excel de costeo del contenedor (obligatorio)
--
-- Una vez cerrada, SOLO el administrador (dueño de la cuenta) puede modificar
-- la importación o sus hijos (abonos, costos, packing list, documentos) —
-- triggers de bloqueo para colaboradores. Reabrir también es solo admin.
--
-- iva_pct: % de IVA de importación editable por pedido (default 19), simétrico
-- a arancel_pct (20260704210000).

ALTER TABLE public.imports
  ADD COLUMN IF NOT EXISTS iva_pct numeric(5, 2) NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS cerrada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cerrada_at timestamptz,
  ADD COLUMN IF NOT EXISTS cerrada_by uuid;

COMMENT ON COLUMN public.imports.iva_pct IS
  'Porcentaje de IVA de importación para el costeo (default 19). Editable por pedido.';
COMMENT ON COLUMN public.imports.cerrada IS
  'Importación cerrada (checklist documental completo). Solo el admin puede modificarla o reabrirla.';

-- ── Documentos del checklist ─────────────────────────────────────────────────
-- Archivos en el bucket 'invoices' con path {auth.uid()}/imports/{import_id}/…
-- (la policy del bucket exige que el primer folder sea el uid del que sube).
CREATE TABLE IF NOT EXISTS public.import_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('swift', 'dim', 'certificado_banrep', 'costeo_excel', 'otro')),
  storage_path text NOT NULL,
  filename text,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_documents_import_idx
  ON public.import_documents(import_id, tipo);

ALTER TABLE public.import_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_documents_owner_or_collab_select" ON public.import_documents;
CREATE POLICY "import_documents_owner_or_collab_select"
  ON public.import_documents FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "import_documents_owner_or_collab_insert" ON public.import_documents;
CREATE POLICY "import_documents_owner_or_collab_insert"
  ON public.import_documents FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "import_documents_owner_or_collab_update" ON public.import_documents;
CREATE POLICY "import_documents_owner_or_collab_update"
  ON public.import_documents FOR UPDATE TO authenticated
  USING (user_id = public.current_data_owner());
DROP POLICY IF EXISTS "import_documents_owner_or_collab_delete" ON public.import_documents;
CREATE POLICY "import_documents_owner_or_collab_delete"
  ON public.import_documents FOR DELETE TO authenticated
  USING (user_id = public.current_data_owner());

-- user_id siempre el dueño de los datos (mismo patrón que el resto de tablas
-- compartidas con colaboradores — 20260507120000).
DROP TRIGGER IF EXISTS set_import_documents_user_id ON public.import_documents;
CREATE TRIGGER set_import_documents_user_id
  BEFORE INSERT ON public.import_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

COMMENT ON TABLE public.import_documents IS
  'Documentos del checklist de cierre de una importación: swift (por abono), DIM, certificado BanRep (excel de legalización), excel de costeo.';

-- ── Cerrar / reabrir (solo el admin = dueño de la cuenta) ────────────────────
CREATE OR REPLACE FUNCTION public.cerrar_importacion(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp record;
  v_pagos int;
  v_swift int;
  v_dim int;
  v_banrep int;
  v_costeo int;
  v_faltantes text[] := '{}';
BEGIN
  SELECT * INTO v_imp FROM public.imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación no encontrada'; END IF;
  IF auth.uid() IS DISTINCT FROM v_imp.user_id THEN
    RAISE EXCEPTION 'Solo el administrador puede cerrar la importación';
  END IF;
  IF v_imp.cerrada THEN
    RETURN jsonb_build_object('ok', true, 'ya_cerrada', true);
  END IF;
  IF v_imp.estado <> 'entregado' THEN
    RAISE EXCEPTION 'Solo se cierra una importación entregada';
  END IF;

  SELECT count(*) INTO v_pagos FROM public.import_payments WHERE import_id = p_import_id;
  SELECT
    count(*) FILTER (WHERE tipo = 'swift'),
    count(*) FILTER (WHERE tipo = 'dim'),
    count(*) FILTER (WHERE tipo = 'certificado_banrep'),
    count(*) FILTER (WHERE tipo = 'costeo_excel')
  INTO v_swift, v_dim, v_banrep, v_costeo
  FROM public.import_documents WHERE import_id = p_import_id;

  -- Un swift por abono (mínimo 1 aunque no haya abonos registrados).
  IF v_swift < GREATEST(v_pagos, 1) THEN
    v_faltantes := array_append(v_faltantes,
      format('swifts: %s de %s abonos', v_swift, GREATEST(v_pagos, 1)));
  END IF;
  IF v_dim = 0 THEN v_faltantes := array_append(v_faltantes, 'DIM (declaración de importación)'); END IF;
  IF v_banrep = 0 THEN v_faltantes := array_append(v_faltantes, 'certificado BanRep (excel de legalización)'); END IF;
  IF v_costeo = 0 THEN v_faltantes := array_append(v_faltantes, 'excel de costeo'); END IF;

  IF array_length(v_faltantes, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'faltantes', to_jsonb(v_faltantes));
  END IF;

  UPDATE public.imports
  SET cerrada = true, cerrada_at = now(), cerrada_by = auth.uid(), updated_at = now()
  WHERE id = p_import_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reabrir_importacion(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp record;
BEGIN
  SELECT * INTO v_imp FROM public.imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación no encontrada'; END IF;
  IF auth.uid() IS DISTINCT FROM v_imp.user_id THEN
    RAISE EXCEPTION 'Solo el administrador puede reabrir la importación';
  END IF;
  UPDATE public.imports
  SET cerrada = false, cerrada_at = NULL, cerrada_by = NULL, updated_at = now()
  WHERE id = p_import_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cerrar_importacion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reabrir_importacion(uuid) TO authenticated;

-- ── Bloqueo: importación cerrada = solo admin ────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_cerrada_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.cerrada AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'La importación está cerrada — solo el administrador puede modificarla';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS imports_cerrada_lock ON public.imports;
CREATE TRIGGER imports_cerrada_lock
  BEFORE UPDATE OR DELETE ON public.imports
  FOR EACH ROW EXECUTE FUNCTION public.import_cerrada_lock();

-- Hijos (abonos, costos, packing list, documentos): mismo bloqueo vía parent.
CREATE OR REPLACE FUNCTION public.import_child_cerrada_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_import_id uuid;
  v_owner uuid;
  v_cerrada boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN v_import_id := OLD.import_id;
  ELSE v_import_id := NEW.import_id;
  END IF;
  SELECT user_id, cerrada INTO v_owner, v_cerrada
  FROM public.imports WHERE id = v_import_id;
  IF COALESCE(v_cerrada, false) AND auth.uid() IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'La importación está cerrada — solo el administrador puede modificarla';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS import_payments_cerrada_lock ON public.import_payments;
CREATE TRIGGER import_payments_cerrada_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.import_payments
  FOR EACH ROW EXECUTE FUNCTION public.import_child_cerrada_lock();

DROP TRIGGER IF EXISTS import_costs_cerrada_lock ON public.import_costs;
CREATE TRIGGER import_costs_cerrada_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.import_costs
  FOR EACH ROW EXECUTE FUNCTION public.import_child_cerrada_lock();

DROP TRIGGER IF EXISTS import_items_cerrada_lock ON public.import_items;
CREATE TRIGGER import_items_cerrada_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.import_items
  FOR EACH ROW EXECUTE FUNCTION public.import_child_cerrada_lock();

DROP TRIGGER IF EXISTS import_documents_cerrada_lock ON public.import_documents;
CREATE TRIGGER import_documents_cerrada_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.import_documents
  FOR EACH ROW EXECUTE FUNCTION public.import_child_cerrada_lock();
