-- HOTFIX: colaboradores no podían guardar remisiones porque las policies
-- de remision_items siguen usando auth.uid() — la migración
-- 20260507120000_collaborators_share_owner_data se saltea remision_items
-- porque la tabla no tiene columna user_id (depende vía remision_id).
--
-- Síntoma: "new row violates row-level security policy for table
-- remision_items" cuando un colaborador intenta crear/editar una remisión.
--
-- Fix: recrear las 4 policies (SELECT/INSERT/UPDATE/DELETE) usando
-- current_data_owner() en lugar de auth.uid() al chequear el dueño de la
-- remisión padre. Owner sigue funcionando idéntico (current_data_owner()
-- == auth.uid() para él) y colaborador queda habilitado.

DROP POLICY IF EXISTS "Users can view their own remision items" ON public.remision_items;
DROP POLICY IF EXISTS "Users can insert their own remision items" ON public.remision_items;
DROP POLICY IF EXISTS "Users can update their own remision items" ON public.remision_items;
DROP POLICY IF EXISTS "Users can delete their own remision items" ON public.remision_items;

CREATE POLICY "remision_items_owner_or_collab_select"
  ON public.remision_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.remisiones r
    WHERE r.id = remision_items.remision_id
      AND r.user_id = public.current_data_owner()
  ));

CREATE POLICY "remision_items_owner_or_collab_insert"
  ON public.remision_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.remisiones r
    WHERE r.id = remision_items.remision_id
      AND r.user_id = public.current_data_owner()
  ));

CREATE POLICY "remision_items_owner_or_collab_update"
  ON public.remision_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.remisiones r
    WHERE r.id = remision_items.remision_id
      AND r.user_id = public.current_data_owner()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.remisiones r
    WHERE r.id = remision_items.remision_id
      AND r.user_id = public.current_data_owner()
  ));

CREATE POLICY "remision_items_owner_or_collab_delete"
  ON public.remision_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.remisiones r
    WHERE r.id = remision_items.remision_id
      AND r.user_id = public.current_data_owner()
  ));

-- remission_payments también quedó con auth.uid() en la migración 20260429170000
-- pero esa SÍ tiene user_id, así que la migración collaborators_share_owner_data
-- ya la actualizó correctamente. Verificamos por idempotencia.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.remision_payments'::regclass
      AND polname LIKE '%owner_or_collab%'
  ) THEN
    -- ya migrada via collaborators_share_owner_data
    NULL;
  END IF;
END $$;
