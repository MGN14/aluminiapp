-- Fix: upsert(onConflict: 'user_id,siigo_id') en siigo-sync-products fallaba con
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- por el mismo motivo que invoices: la migración original creó un UNIQUE INDEX
-- parcial (WHERE siigo_id IS NOT NULL) y PostgREST no propaga el predicado.
--
-- Reemplazamos por un UNIQUE constraint real. En PG, NULLs son distintos en
-- UNIQUE por defecto, así que productos manuales (siigo_id=null) siguen
-- permitiendo múltiples filas por user_id.

DROP INDEX IF EXISTS public.idx_inventory_products_user_siigo_id;

ALTER TABLE public.inventory_products
  DROP CONSTRAINT IF EXISTS inventory_products_user_siigo_id_key;

ALTER TABLE public.inventory_products
  ADD CONSTRAINT inventory_products_user_siigo_id_key UNIQUE (user_id, siigo_id);
