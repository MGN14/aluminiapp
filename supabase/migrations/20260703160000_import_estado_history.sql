-- Historial de cambios de estado de importaciones.
--
-- Antes solo existían columnas sueltas de fecha (fecha_anticipo, fecha_embarque,
-- fecha_arribo_real) que cubrían 3 de los 6 estados y se pisaban sin historia.
-- Ahora cada cambio de estado registra SU fecha (editable por el usuario al
-- cambiar) y la app calcula cuánto demora cada etapa y cada importación.
--
-- Una fila por (import, estado): si se re-entra a un estado, se actualiza la
-- fecha (UNIQUE + upsert). Suficiente para medir duraciones de etapa.

CREATE TABLE IF NOT EXISTS public.import_estado_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  estado text NOT NULL CHECK (estado IN ('cotizacion', 'anticipo', 'produccion', 'transito', 'aduana', 'entregado', 'cancelado')),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, estado)
);

CREATE INDEX IF NOT EXISTS import_estado_history_import_idx
  ON public.import_estado_history(import_id, fecha);

COMMENT ON TABLE public.import_estado_history IS
  'Fecha en que cada importación entró a cada estado. Base para calcular duración de etapas (producción, tránsito, aduana...) por importación y en promedio.';

ALTER TABLE public.import_estado_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_estado_history_owner_all" ON public.import_estado_history;
CREATE POLICY "import_estado_history_owner_all"
  ON public.import_estado_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Backfill desde las fechas de flujo ya guardadas en imports, más el estado
-- actual (con updated_at como mejor aproximación si no hay fecha específica).
INSERT INTO public.import_estado_history (user_id, import_id, estado, fecha)
SELECT user_id, id, 'cotizacion', fecha_cotizacion FROM public.imports WHERE fecha_cotizacion IS NOT NULL
UNION ALL
SELECT user_id, id, 'anticipo', fecha_anticipo FROM public.imports WHERE fecha_anticipo IS NOT NULL
UNION ALL
SELECT user_id, id, 'transito', fecha_embarque FROM public.imports WHERE fecha_embarque IS NOT NULL
UNION ALL
SELECT user_id, id, 'entregado', fecha_arribo_real FROM public.imports WHERE fecha_arribo_real IS NOT NULL
ON CONFLICT (import_id, estado) DO NOTHING;

-- El estado ACTUAL de cada import también queda registrado (si no vino ya del
-- backfill de fechas): usamos updated_at::date como aproximación.
INSERT INTO public.import_estado_history (user_id, import_id, estado, fecha)
SELECT user_id, id, estado, updated_at::date FROM public.imports
ON CONFLICT (import_id, estado) DO NOTHING;
