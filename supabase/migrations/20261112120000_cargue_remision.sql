-- ============================================================================
-- Cargue desde la remisión: plan de cargue + fotos del camión cargado.
-- ============================================================================
-- El despacho nace de la remisión: se planea el orden de cargue (lo más pesado
-- primero, lo que está a la mano, o como viene la remisión), se cuentan
-- PAQUETES (no unidades) y al cerrar se toma SIEMPRE una foto del camión
-- cargado para poder buscarla si hay un reclamo.
--
-- Aditiva: tablas nuevas + bucket privado. No toca remisiones ni inventario.
-- Patrón de RLS current_data_owner(): los colaboradores de bodega ven y
-- escriben lo del dueño de la cuenta.
-- ============================================================================

-- ─── Plan y cierre del cargue (uno por remisión) ───
CREATE TABLE IF NOT EXISTS public.remision_cargues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remision_id uuid NOT NULL REFERENCES public.remisiones(id) ON DELETE CASCADE,
  criterio text NOT NULL DEFAULT 'remision',     -- peso | ubicacion | remision | manual
  orden jsonb NOT NULL DEFAULT '[]'::jsonb,      -- referencias (llave normalizada) en orden de cargue
  empaques jsonb NOT NULL DEFAULT '{}'::jsonb,   -- referencia → unidades por paquete (lo que se ajustó a mano)
  vehiculo text,
  conductor text,
  capacidad_kg numeric,
  seguridad jsonb NOT NULL DEFAULT '{}'::jsonb,  -- checklist de seguridad marcado al cerrar
  estado text NOT NULL DEFAULT 'planeado',       -- planeado | cargado
  paquetes integer,
  unidades numeric,
  peso_kg numeric,
  planeado_por uuid,
  cerrado_por uuid,
  cerrado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remision_cargues_remision_uq UNIQUE (remision_id)
);

ALTER TABLE public.remision_cargues ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.remision_cargues'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.remision_cargues', pol.polname); END LOOP;
END $$;
CREATE POLICY remision_cargues_select ON public.remision_cargues FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY remision_cargues_insert ON public.remision_cargues FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY remision_cargues_update ON public.remision_cargues FOR UPDATE TO authenticated USING (user_id = public.current_data_owner()) WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY remision_cargues_delete ON public.remision_cargues FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.remision_cargues;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.remision_cargues
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

DROP TRIGGER IF EXISTS update_remision_cargues_updated_at ON public.remision_cargues;
CREATE TRIGGER update_remision_cargues_updated_at
  BEFORE UPDATE ON public.remision_cargues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Fotos del cargue (para reclamos) ───
CREATE TABLE IF NOT EXISTS public.remision_cargue_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remision_id uuid NOT NULL REFERENCES public.remisiones(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  tomada_por uuid,
  tomada_at timestamptz NOT NULL DEFAULT now(),
  conteo_ia integer,             -- paquetes que la IA ve en la foto
  conteo_ia_detalle jsonb,       -- { confianza, notas, modelo }
  conteo_ia_at timestamptz,
  nota text
);
CREATE INDEX IF NOT EXISTS idx_remision_cargue_fotos_remision ON public.remision_cargue_fotos (remision_id);

ALTER TABLE public.remision_cargue_fotos ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.remision_cargue_fotos'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.remision_cargue_fotos', pol.polname); END LOOP;
END $$;
CREATE POLICY remision_cargue_fotos_select ON public.remision_cargue_fotos FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY remision_cargue_fotos_insert ON public.remision_cargue_fotos FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY remision_cargue_fotos_update ON public.remision_cargue_fotos FOR UPDATE TO authenticated USING (user_id = public.current_data_owner()) WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY remision_cargue_fotos_delete ON public.remision_cargue_fotos FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.remision_cargue_fotos;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.remision_cargue_fotos
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

-- ─── Bucket privado para las fotos: carpeta 1 = dueño de la cuenta ───
-- (con current_data_owner, la foto que sube un colaborador de bodega la ve
-- el dueño y viceversa; las otras cuentas no).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cargues', 'cargues', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cargues_owner_select" ON storage.objects;
CREATE POLICY "cargues_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cargues' AND (storage.foldername(name))[1] = public.current_data_owner()::text);

DROP POLICY IF EXISTS "cargues_owner_insert" ON storage.objects;
CREATE POLICY "cargues_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cargues' AND (storage.foldername(name))[1] = public.current_data_owner()::text);

DROP POLICY IF EXISTS "cargues_owner_delete" ON storage.objects;
CREATE POLICY "cargues_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cargues' AND (storage.foldername(name))[1] = public.current_data_owner()::text);

NOTIFY pgrst, 'reload schema';
