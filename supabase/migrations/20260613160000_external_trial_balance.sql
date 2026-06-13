-- ============================================================================
-- Balance de prueba externo (Siigo) para comparar contra el balance de la app
-- ============================================================================
-- El usuario exporta el balance de prueba de Siigo (cuenta PUC + saldo) y lo
-- importa acá. La app lo clasifica por código PUC en los mismos rubros del
-- Balance General derivado y los pone lado a lado. Snapshot único por usuario:
-- al re-importar se reemplazan las filas (replace-all).

CREATE TABLE IF NOT EXISTS public.external_trial_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_code text NOT NULL,        -- código PUC (ej. '110505')
  account_name text NULL,
  saldo numeric(18, 2) NOT NULL DEFAULT 0,  -- saldo final (+ activo/gasto, − ...). Normalizado en la app.
  snapshot_date date NULL,           -- fecha de corte del balance de prueba
  source text NOT NULL DEFAULT 'siigo',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_trial_balance_user_idx ON public.external_trial_balance(user_id);

COMMENT ON TABLE public.external_trial_balance IS
  'Balance de prueba importado de Siigo (u otro contable) para comparar con el balance derivado de la app. Snapshot reemplazable por usuario.';

-- Tabla "categoría A" (datos de empresa): visibilidad por current_data_owner + trigger.
ALTER TABLE public.external_trial_balance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "etb_owner_data" ON public.external_trial_balance;
CREATE POLICY "etb_owner_data"
  ON public.external_trial_balance FOR ALL
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_etb_user_id ON public.external_trial_balance;
CREATE TRIGGER set_etb_user_id
  BEFORE INSERT ON public.external_trial_balance
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

NOTIFY pgrst, 'reload schema';
