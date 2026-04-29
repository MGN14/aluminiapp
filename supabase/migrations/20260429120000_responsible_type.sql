-- Separar prestadores de Caja Menor de los beneficiarios de Conciliación
-- Bancaria. Antes ambos vivían en una sola lista, lo que ensuciaba los
-- dropdowns de banco con coteros e instaladores ocasionales.
--
-- Solucion: campo responsible_type en responsibles.
--   'banking'    → solo aparece en Conciliacion Bancaria
--   'petty_cash' → solo aparece en Caja Menor
--   'both'       → aparece en ambos (caso raro)
--
-- Default 'banking' para registros existentes (preservacion de comportamiento).
-- Migration aditiva, sin destruir datos.

ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS responsible_type text NOT NULL DEFAULT 'banking'
    CHECK (responsible_type IN ('banking', 'petty_cash', 'both'));

CREATE INDEX IF NOT EXISTS responsibles_user_type_idx
  ON public.responsibles(user_id, responsible_type)
  WHERE active = true;

COMMENT ON COLUMN public.responsibles.responsible_type IS 'banking: solo Conciliacion Bancaria | petty_cash: solo Caja Menor (coteros, instaladores ocasionales) | both: aparece en ambos.';
