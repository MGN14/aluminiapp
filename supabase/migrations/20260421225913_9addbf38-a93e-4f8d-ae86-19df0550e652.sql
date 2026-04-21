BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_statement_period_type') THEN
    CREATE TYPE public.bank_statement_period_type AS ENUM ('monthly_close', 'weekly', 'custom');
  END IF;
END $$;

ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS period_type public.bank_statement_period_type
    NOT NULL DEFAULT 'monthly_close';

ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS saldo_anterior numeric,
  ADD COLUMN IF NOT EXISTS saldo_actual numeric,
  ADD COLUMN IF NOT EXISTS saldo_promedio numeric,
  ADD COLUMN IF NOT EXISTS total_abonos numeric,
  ADD COLUMN IF NOT EXISTS total_cargos numeric,
  ADD COLUMN IF NOT EXISTS intereses numeric,
  ADD COLUMN IF NOT EXISTS retefuente numeric;

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT 1
    FROM public.bank_statements
    WHERE deleted_at IS NULL
      AND period_start IS NOT NULL
      AND period_end IS NOT NULL
    GROUP BY user_id, bank_name, period_start, period_end, period_type
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'No se puede crear idx_bank_statements_unique_period_v2: % grupos duplicados. Resolvé duplicados antes de correr esta migración.',
      dup_count;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_bank_statements_unique_period;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statements_unique_period_v2
  ON public.bank_statements (user_id, bank_name, period_start, period_end, period_type)
  WHERE deleted_at IS NULL
    AND period_start IS NOT NULL
    AND period_end IS NOT NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS bank_code text;

CREATE INDEX IF NOT EXISTS idx_transactions_bank_code
  ON public.transactions (user_id, bank_code)
  WHERE bank_code IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.bank_statements.period_type IS
  'Tipo de período: monthly_close (extracto oficial del banco), weekly (CSV de movimientos), custom (rango arbitrario). Default: monthly_close.';

COMMENT ON COLUMN public.bank_statements.saldo_anterior IS
  'Saldo anterior del resumen mensual del XLSX. Solo se puebla con period_type=monthly_close.';

COMMENT ON COLUMN public.bank_statements.saldo_actual IS
  'Saldo actual al cierre del mes según XLSX. Solo se puebla con period_type=monthly_close.';

COMMENT ON COLUMN public.transactions.bank_code IS
  'Código DCTO del banco (Bancolombia: 3339=4x1000, 2999=intereses, etc). Usado por reglas de conciliación deterministas.';

COMMIT;

NOTIFY pgrst, 'reload schema';