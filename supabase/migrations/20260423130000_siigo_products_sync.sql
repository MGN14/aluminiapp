-- Siigo products sync: idempotent upserts + timestamp tracking
-- Adds siigo_id (nullable) for products pulled from Siigo /v1/products,
-- last_siigo_sync_at for diagnostics, and last_synced_products_at on
-- user_siigo_credentials so the UI can show "última sincronización".

ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS siigo_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','siigo')),
  ADD COLUMN IF NOT EXISTS last_siigo_sync_at timestamptz;

-- Idempotent re-sync: same Siigo product can never insert twice for a user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_products_user_siigo_id
  ON public.inventory_products (user_id, siigo_id)
  WHERE siigo_id IS NOT NULL;

ALTER TABLE public.user_siigo_credentials
  ADD COLUMN IF NOT EXISTS last_products_pulled_at timestamptz;
