-- Fix: upsert(onConflict: 'user_id,siigo_id') en siigo-sync-invoices fallaba con
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- porque la migración original creó un UNIQUE INDEX parcial (WHERE siigo_id IS NOT NULL)
-- y PostgREST no propaga el predicado en el upsert.
--
-- Reemplazamos por un UNIQUE constraint real. En PG, NULLs son distintos en UNIQUE
-- por defecto, así que facturas manuales (siigo_id=null) siguen permitiendo
-- múltiples filas por user_id sin romper nada.

DROP INDEX IF EXISTS public.idx_invoices_user_siigo_id;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_user_siigo_id_key;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_user_siigo_id_key UNIQUE (user_id, siigo_id);
