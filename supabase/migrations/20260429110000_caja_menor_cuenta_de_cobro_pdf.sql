-- Caja Menor: campos para generar cuenta de cobro PDF.
-- Aditiva, sin destruir datos. Cubre el caso de uso real (informalidad):
-- coteros, instaladores, contratistas esporadicos.

-- ============================================================================
-- 1. Extender profiles con datos de la empresa del contratante
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_nit text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS company_city text,
  ADD COLUMN IF NOT EXISTS company_phone text;

COMMENT ON COLUMN public.profiles.company_nit IS 'NIT completo de la empresa del usuario, con DV. Para encabezado de cuentas de cobro.';
COMMENT ON COLUMN public.profiles.company_address IS 'Direccion fiscal de la empresa. Para encabezado de cuentas de cobro.';
COMMENT ON COLUMN public.profiles.company_city IS 'Ciudad de la empresa. Para encabezado y "Bogota, 29 de abril de 2026".';

-- ============================================================================
-- 2. Extender responsibles con datos del prestador (persona natural informal)
-- ============================================================================
ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS tipo_documento text CHECK (tipo_documento IN ('CC', 'CE', 'PA', 'NIT')),
  ADD COLUMN IF NOT EXISTS ciudad text,
  ADD COLUMN IF NOT EXISTS telefono text;

COMMENT ON COLUMN public.responsibles.tipo_documento IS 'CC | CE | PA | NIT. Para coteros e informales generalmente CC.';
COMMENT ON COLUMN public.responsibles.ciudad IS 'Ciudad del prestador del servicio.';

-- ============================================================================
-- 3. Extender petty_cash_movements con campos de cuenta de cobro
-- ============================================================================
ALTER TABLE public.petty_cash_movements
  ADD COLUMN IF NOT EXISTS numero_consecutivo text,
  ADD COLUMN IF NOT EXISTS incluye_prestaciones_sociales boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retencion_amount numeric(14, 2);

CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_consecutivo_user_unique
  ON public.petty_cash_movements(user_id, numero_consecutivo)
  WHERE numero_consecutivo IS NOT NULL;

COMMENT ON COLUMN public.petty_cash_movements.numero_consecutivo IS 'Numero consecutivo de la cuenta de cobro (auto: CDC-YYYY-NNNN). Solo para kind=cuenta_de_cobro. Asignado por trigger BEFORE INSERT.';
COMMENT ON COLUMN public.petty_cash_movements.incluye_prestaciones_sociales IS 'Si true, el PDF incluye la declaracion del Art. 50 Ley 789/2002 (pago de salud y pension).';
COMMENT ON COLUMN public.petty_cash_movements.retencion_amount IS 'Retencion en la fuente aplicada al pago, opcional. El usuario o su contador la calculan manualmente.';

-- ============================================================================
-- 4. Trigger: asignar numero_consecutivo automatico en INSERT cuando
--    kind = 'cuenta_de_cobro' y no se proveyo uno. Formato CDC-YYYY-NNNN
--    secuencial por usuario y por anio (reset cada anio).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_petty_cash_consecutivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num int;
  year_str text;
BEGIN
  IF NEW.kind = 'cuenta_de_cobro' AND (NEW.numero_consecutivo IS NULL OR NEW.numero_consecutivo = '') THEN
    year_str := to_char(NEW.date, 'YYYY');
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(numero_consecutivo FROM ('CDC-' || year_str || '-(\d+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.petty_cash_movements
    WHERE user_id = NEW.user_id
      AND numero_consecutivo IS NOT NULL
      AND numero_consecutivo ~ ('^CDC-' || year_str || '-\d+$');
    NEW.numero_consecutivo := 'CDC-' || year_str || '-' || lpad(next_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS petty_cash_set_consecutivo ON public.petty_cash_movements;
CREATE TRIGGER petty_cash_set_consecutivo
  BEFORE INSERT ON public.petty_cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_petty_cash_consecutivo();
