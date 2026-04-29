-- Hoja membretada: subida de imagen PNG/JPG por usuario, usada como
-- background de cuentas de cobro y comprobantes de pago.
-- Storage privado por usuario, signed URL on demand.

-- ============================================================================
-- 1. Bucket privado para hojas membretadas
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'letterheads',
  'letterheads',
  false,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/jpg']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. RLS policies — owner-only por carpeta {user_id}/...
-- ============================================================================
DROP POLICY IF EXISTS "letterheads_owner_select" ON storage.objects;
CREATE POLICY "letterheads_owner_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'letterheads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "letterheads_owner_insert" ON storage.objects;
CREATE POLICY "letterheads_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'letterheads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "letterheads_owner_update" ON storage.objects;
CREATE POLICY "letterheads_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'letterheads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "letterheads_owner_delete" ON storage.objects;
CREATE POLICY "letterheads_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'letterheads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- 3. Columnas en profiles para almacenar path + margenes seguros
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS letterhead_path text,
  ADD COLUMN IF NOT EXISTS letterhead_top_margin_mm integer NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS letterhead_bottom_margin_mm integer NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.profiles.letterhead_path IS 'Path en storage bucket "letterheads" del PNG/JPG de hoja membretada del usuario. NULL = sin letterhead, usar diseno base.';
COMMENT ON COLUMN public.profiles.letterhead_top_margin_mm IS 'Margen superior en mm que se respeta para no pisar el logo/header de la hoja membretada.';
COMMENT ON COLUMN public.profiles.letterhead_bottom_margin_mm IS 'Margen inferior en mm que se respeta para no pisar el footer de la hoja membretada.';
