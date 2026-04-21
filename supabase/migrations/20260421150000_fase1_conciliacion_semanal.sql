-- =====================================================
-- Fase 1: preparar schema para conciliación semanal por CSV
-- =====================================================
-- Cambios 100% aditivos y reversibles:
--   * Agrega enum `bank_statement_period_type`.
--   * Agrega `period_type` a bank_statements (default 'monthly_close',
--     los registros viejos quedan marcados así automáticamente).
--   * Agrega 7 columnas nulas para el resumen del XLSX mensual.
--   * Reemplaza el UNIQUE index viejo (basado en month/year) por uno
--     basado en (user_id, bank_name, period_start, period_end, period_type),
--     que soporta tanto cierres mensuales como uploads semanales.
--   * Agrega `bank_code` a transactions (código DCTO de Bancolombia)
--     y un índice parcial para lookups por ese código.
--
-- NO cambia comportamiento de la app: statement_month/statement_year ya
-- eran nullable antes de esta migración, y ningún código existente lee
-- las columnas nuevas.
--
-- Rollback: ver `rollback_20260421150000_fase1_conciliacion_semanal.sql`.

BEGIN;

-- 1. Enum period_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_statement_period_type') THEN
    CREATE TYPE public.bank_statement_period_type AS ENUM ('monthly_close', 'weekly', 'custom');
  END IF;
END $$;

-- 2. bank_statements: period_type con default 'monthly_close'
-- Default + NOT NULL juntos: los registros existentes quedan como 'monthly_close'
-- sin necesidad de UPDATE explícito.
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS period_type public.bank_statement_period_type
    NOT NULL DEFAULT 'monthly_close';

-- 3. bank_statements: columnas de resumen del extracto mensual (XLSX)
-- Todas nullable, se pueblan solo cuando period_type='monthly_close'.
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS saldo_anterior numeric,
  ADD COLUMN IF NOT EXISTS saldo_actual numeric,
  ADD COLUMN IF NOT EXISTS saldo_promedio numeric,
  ADD COLUMN IF NOT EXISTS total_abonos numeric,
  ADD COLUMN IF NOT EXISTS total_cargos numeric,
  ADD COLUMN IF NOT EXISTS intereses numeric,
  ADD COLUMN IF NOT EXISTS retefuente numeric;

-- 4. Reemplazar UNIQUE index viejo por uno basado en rango de fechas.
-- Antes: (user_id, bank_name, statement_month, statement_year) — forzaba
--        un solo extracto por mes-año, incompatible con CSV semanales.
-- Ahora: (user_id, bank_name, period_start, period_end, period_type) —
--        permite múltiples cargas semanales y un cierre mensual separado
--        para el mismo período.
-- Chequeo defensivo: si hay duplicados por la nueva clave, abortar con
-- mensaje claro en vez de fallar con un error críptico de índice único.
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
      'No se puede crear idx_bank_statements_unique_period_v2: % grupos duplicados en (user_id, bank_name, period_start, period_end, period_type). Resolvé duplicados antes de correr esta migración.',
      dup_count;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_bank_statements_unique_period;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statements_unique_period_v2
  ON public.bank_statements (user_id, bank_name, period_start, period_end, period_type)
  WHERE deleted_at IS NULL
    AND period_start IS NOT NULL
    AND period_end IS NOT NULL;

-- 5. transactions: bank_code (código DCTO del banco, ej: 3339=4x1000)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS bank_code text;

-- Índice parcial para filtros/joins por bank_code — base para futuras
-- reglas de conciliación determinista (Fase 4).
CREATE INDEX IF NOT EXISTS idx_transactions_bank_code
  ON public.transactions (user_id, bank_code)
  WHERE bank_code IS NOT NULL AND deleted_at IS NULL;

-- Comentarios para documentar propósito en la DB
COMMENT ON COLUMN public.bank_statements.period_type IS
  'Tipo de período: monthly_close (extracto oficial del banco), weekly (CSV de movimientos), custom (rango arbitrario). Default: monthly_close.';

COMMENT ON COLUMN public.bank_statements.saldo_anterior IS
  'Saldo anterior del resumen mensual del XLSX. Solo se puebla con period_type=monthly_close.';

COMMENT ON COLUMN public.bank_statements.saldo_actual IS
  'Saldo actual al cierre del mes según XLSX. Solo se puebla con period_type=monthly_close.';

COMMENT ON COLUMN public.transactions.bank_code IS
  'Código DCTO del banco (Bancolombia: 3339=4x1000, 2999=intereses, etc). Usado por reglas de conciliación deterministas.';

COMMIT;
