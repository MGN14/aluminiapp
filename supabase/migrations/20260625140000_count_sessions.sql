-- Sesiones de conteo físico: captura la duración de cada conteo (inicio→fin) +
-- cuántas referencias/unidades se contaron y cuántas tuvieron diferencia.
-- Alimenta el reporte "tiempo de inventario" y productividad por operario.
-- RLS compartida (owner + colaboradores) como el resto del inventario.

CREATE TABLE IF NOT EXISTS public.count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operator_id uuid,
  started_at timestamptz,
  ended_at timestamptz NOT NULL DEFAULT now(),
  refs_count integer NOT NULL DEFAULT 0,
  units_count numeric NOT NULL DEFAULT 0,
  diffs_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_count_sessions_user ON public.count_sessions (user_id, ended_at DESC);

ALTER TABLE public.count_sessions ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.count_sessions'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.count_sessions', pol.polname); END LOOP;
END $$;
CREATE POLICY count_sessions_select ON public.count_sessions FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY count_sessions_insert ON public.count_sessions FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.count_sessions;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.count_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

NOTIFY pgrst, 'reload schema';
