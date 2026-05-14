-- Acoplar el módulo de Cotizaciones al modelo de colaboradores.
--
-- Problema: aluminum_catalog, quotations y quotation_items se crearon con
-- RLS basada en auth.uid() directo — no pasaron por el modelo de
-- colaboradores (20260507120000_collaborators_share_owner_data). Consecuencias
-- para colaboradores:
--   1. No ven el catálogo / cotizaciones del owner (RLS by auth.uid()).
--   2. Lo que crean queda con user_id = colab_id, el owner no lo ve.
--   3. generate_quote_number() calcula MAX por NEW.user_id → mismo bug del
--      consecutivo que ya arreglamos en remisiones y caja menor (las
--      cotizaciones del colaborador salen todas COT-YYYY-0001).
--
-- Fix: recrear policies con current_data_owner(), agregar el trigger
-- set_user_id_to_data_owner_trg a las tablas con user_id, arreglar el
-- trigger de numeración, y backfill de los consecutivos rotos.

-- ── 1. aluminum_catalog ──────────────────────────────────────────────────
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.aluminum_catalog'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.aluminum_catalog', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "aluminum_catalog_owner_or_collab_select"
  ON public.aluminum_catalog FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
CREATE POLICY "aluminum_catalog_owner_or_collab_insert"
  ON public.aluminum_catalog FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY "aluminum_catalog_owner_or_collab_update"
  ON public.aluminum_catalog FOR UPDATE TO authenticated
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY "aluminum_catalog_owner_or_collab_delete"
  ON public.aluminum_catalog FOR DELETE TO authenticated
  USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.aluminum_catalog;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.aluminum_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

-- ── 2. quotations ────────────────────────────────────────────────────────
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.quotations'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.quotations', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "quotations_owner_or_collab_select"
  ON public.quotations FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
CREATE POLICY "quotations_owner_or_collab_insert"
  ON public.quotations FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY "quotations_owner_or_collab_update"
  ON public.quotations FOR UPDATE TO authenticated
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY "quotations_owner_or_collab_delete"
  ON public.quotations FOR DELETE TO authenticated
  USING (user_id = public.current_data_owner());

-- El trigger del consecutivo (set_quote_number_before_insert) corre antes
-- que set_user_id_to_data_owner_trg por orden alfabético — igual que pasaba
-- en remisiones. La función generate_quote_number ya resuelve
-- current_data_owner() (ver más abajo), así que el orden no importa, pero
-- igual agregamos el trigger de reescritura de user_id.
DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.quotations;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

-- ── 3. quotation_items (RLS vía parent, sin columna user_id) ─────────────
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.quotation_items'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON public.quotation_items', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "quotation_items_owner_or_collab_select"
  ON public.quotation_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id
      AND q.user_id = public.current_data_owner()
  ));
CREATE POLICY "quotation_items_owner_or_collab_insert"
  ON public.quotation_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id
      AND q.user_id = public.current_data_owner()
  ));
CREATE POLICY "quotation_items_owner_or_collab_update"
  ON public.quotation_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id
      AND q.user_id = public.current_data_owner()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id
      AND q.user_id = public.current_data_owner()
  ));
CREATE POLICY "quotation_items_owner_or_collab_delete"
  ON public.quotation_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.id = quotation_items.quotation_id
      AND q.user_id = public.current_data_owner()
  ));

-- ── 4. generate_quote_number — usar current_data_owner() ─────────────────
CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_max_seq INTEGER;
  v_next_seq INTEGER;
  v_effective_user_id uuid;
BEGIN
  IF NEW.quote_number IS NOT NULL AND NEW.quote_number <> '' THEN
    RETURN NEW;
  END IF;

  -- user_id efectivo: para colaboradores, el owner real. Service_role
  -- (auth.uid() NULL) usa NEW.user_id tal cual.
  IF auth.uid() IS NOT NULL THEN
    v_effective_user_id := public.current_data_owner();
    IF v_effective_user_id IS NULL THEN
      v_effective_user_id := NEW.user_id;
    END IF;
  ELSE
    v_effective_user_id := NEW.user_id;
  END IF;

  v_year := to_char(COALESCE(NEW.issue_date, CURRENT_DATE), 'YYYY');

  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(quote_number, '^COT-' || v_year || '-', ''), '')::INTEGER
  ), 0)
  INTO v_max_seq
  FROM public.quotations
  WHERE user_id = v_effective_user_id  -- antes: NEW.user_id (rompía para colab)
    AND quote_number ~ ('^COT-' || v_year || '-[0-9]+$');

  v_next_seq := v_max_seq + 1;
  NEW.quote_number := 'COT-' || v_year || '-' || lpad(v_next_seq::TEXT, 4, '0');

  RETURN NEW;
END;
$$;

-- ── 5. Backfill: renumerar quote_number duplicados ───────────────────────
-- Renumera por (user_id, año del issue_date) ordenado por created_at.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT
      id,
      to_char(COALESCE(issue_date, created_at::date), 'YYYY') AS yr,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, to_char(COALESCE(issue_date, created_at::date), 'YYYY')
        ORDER BY created_at ASC, id ASC
      ) AS seq
    FROM public.quotations
  LOOP
    UPDATE public.quotations
    SET quote_number = 'COT-' || r.yr || '-' || lpad(r.seq::text, 4, '0'),
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $$;
