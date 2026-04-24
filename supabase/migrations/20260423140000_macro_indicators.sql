-- Macro indicators (TRM, IPC, DTF, IBR, PIB sectorial, etc.)
-- Shared across all users (read-only); only service_role can write.

CREATE TABLE IF NOT EXISTS public.macro_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_type text NOT NULL,
    -- 'trm' | 'ipc_total' | 'ipc_sector' | 'pib_sector' | 'dtf' | 'ibr'
  sector_code text NOT NULL DEFAULT '',
    -- CIIU prefix (e.g. '46' for comercio al por mayor); '' for global indicators
  sector_name text,
  period_date date NOT NULL,
  value numeric NOT NULL,
  unit text,
    -- 'COP' | '%' | 'index'
  source text,
    -- 'datos.gov.co' | 'banrep' | 'dane' | 'manual'
  metadata jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (indicator, sector, date). Global indicators use sector_code = ''.
CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_indicators_unique
  ON public.macro_indicators (indicator_type, sector_code, period_date);

CREATE INDEX IF NOT EXISTS idx_macro_indicators_type_date
  ON public.macro_indicators (indicator_type, period_date DESC);

ALTER TABLE public.macro_indicators ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read macro indicators (they're public data)
CREATE POLICY "macro_indicators_read_all"
  ON public.macro_indicators
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service_role writes (edge functions / cron)
-- (no INSERT/UPDATE/DELETE policy for authenticated → effectively denied)

NOTIFY pgrst, 'reload schema';
