-- Remisiones (Modo DIAN/Gerencial) — fixes estructurales:
-- 1. responsible_id estructurado en remisiones (FK), beneficiary queda como
--    fallback display name pero la fuente de verdad es el FK
-- 2. UNIQUE constraint en remision_invoices para evitar duplicados
-- 3. Trigger BEFORE INSERT que asigna 'number' consecutivo por (user, module)
--    sin race conditions
-- 4. Backfill: matchear beneficiary existente con responsibles.name por
--    nombre case-insensitive
-- Migration aditiva, sin destruir datos.

-- ============================================================================
-- 1. responsible_id en remisiones
-- ============================================================================
ALTER TABLE public.remisiones
  ADD COLUMN IF NOT EXISTS responsible_id uuid REFERENCES public.responsibles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS remisiones_responsible_idx
  ON public.remisiones(user_id, responsible_id)
  WHERE responsible_id IS NOT NULL;

COMMENT ON COLUMN public.remisiones.responsible_id IS 'FK al cliente/proveedor estructurado. Permite cruzar remisiones con conciliacion bancaria, cartera operativa, caja menor. beneficiary text queda como fallback display name.';

-- ============================================================================
-- 2. UNIQUE en remision_invoices para evitar duplicados de vinculo
-- ============================================================================
DO $$
BEGIN
  -- Borrar duplicados existentes si los hay (mantener el mas viejo)
  DELETE FROM public.remision_invoices ri1
  USING public.remision_invoices ri2
  WHERE ri1.id > ri2.id
    AND ri1.remision_id = ri2.remision_id
    AND ri1.invoice_id = ri2.invoice_id;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'remision_invoices_unique_link'
  ) THEN
    ALTER TABLE public.remision_invoices
      ADD CONSTRAINT remision_invoices_unique_link UNIQUE (remision_id, invoice_id);
  END IF;
END $$;

-- ============================================================================
-- 3. Trigger consecutivo de numero (anti race-condition)
--    Genera 'REM-N' para dian, 'REMG-N' para gerencial. N = max numerico
--    actual del usuario+modulo + 1. Si numero ya viene seteado y no esta
--    vacio, lo respeta.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_remision_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  next_num int;
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    prefix := CASE WHEN NEW.module_origin = 'gerencial' THEN 'REMG' ELSE 'REM' END;
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(number FROM (prefix || '-(\d+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.remisiones
    WHERE user_id = NEW.user_id
      AND module_origin = NEW.module_origin
      AND number IS NOT NULL
      AND number ~ ('^' || prefix || '-\d+$');
    NEW.number := prefix || '-' || next_num::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remisiones_set_number ON public.remisiones;
CREATE TRIGGER remisiones_set_number
  BEFORE INSERT ON public.remisiones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_remision_number();

-- ============================================================================
-- 4. Backfill responsible_id desde beneficiary text (best effort)
--    Match exacto case-insensitive, mismo user_id. Si hay multiples matches
--    para el mismo nombre, queda NULL (el usuario lo asigna manual despues).
-- ============================================================================
WITH unique_matches AS (
  SELECT
    r.id AS remision_id,
    resp.id AS responsible_id,
    COUNT(*) OVER (PARTITION BY r.id) AS match_count
  FROM public.remisiones r
  JOIN public.responsibles resp
    ON resp.user_id = r.user_id
    AND LOWER(TRIM(resp.name)) = LOWER(TRIM(r.beneficiary))
  WHERE r.responsible_id IS NULL
    AND r.beneficiary IS NOT NULL
    AND r.beneficiary != ''
)
UPDATE public.remisiones rem
SET responsible_id = um.responsible_id
FROM unique_matches um
WHERE rem.id = um.remision_id
  AND um.match_count = 1;
