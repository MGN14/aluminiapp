-- =====================================================
-- ROLLBACK de Fase 1: conciliación semanal
-- =====================================================
-- Revierte la migración 20260421150000_fase1_conciliacion_semanal.sql.
--
-- USO:
--   Solo correr si hay un problema concreto con la migración. Las
--   columnas nuevas son aditivas, así que en condiciones normales no hay
--   razón para revertir.
--
--   IMPORTANTE: este rollback pierde los datos que se hayan guardado en
--   las columnas nuevas (bank_code, saldos, totales, period_type). Para
--   registros viejos eso no es problema porque no se poblaron, pero si
--   ya corrió Fase 2 (parser CSV) y hay transactions con bank_code
--   seteado, ese dato se pierde.
--
-- NO correr este rollback dentro de una misma transacción con la
-- migración up. Correrlo como un script separado.

BEGIN;

-- 1. Eliminar índice parcial nuevo de transactions
DROP INDEX IF EXISTS public.idx_transactions_bank_code;

-- 2. Eliminar bank_code de transactions
ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS bank_code;

-- 3. Eliminar unique index v2 y restaurar el original
DROP INDEX IF EXISTS public.idx_bank_statements_unique_period_v2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statements_unique_period
  ON public.bank_statements (user_id, bank_name, statement_month, statement_year)
  WHERE deleted_at IS NULL
    AND statement_month IS NOT NULL
    AND statement_year IS NOT NULL;

-- 4. Eliminar columnas de resumen del XLSX
ALTER TABLE public.bank_statements
  DROP COLUMN IF EXISTS saldo_anterior,
  DROP COLUMN IF EXISTS saldo_actual,
  DROP COLUMN IF EXISTS saldo_promedio,
  DROP COLUMN IF EXISTS total_abonos,
  DROP COLUMN IF EXISTS total_cargos,
  DROP COLUMN IF EXISTS intereses,
  DROP COLUMN IF EXISTS retefuente;

-- 5. Eliminar period_type
ALTER TABLE public.bank_statements
  DROP COLUMN IF EXISTS period_type;

-- 6. Eliminar el enum (solo si ya no lo usa nada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_statement_period_type') THEN
    DROP TYPE public.bank_statement_period_type;
  END IF;
END $$;

COMMIT;
