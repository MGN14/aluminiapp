-- ============================================================================
-- Caja Nequi: los INGRESOS los carga cualquiera, los GASTOS solo el dueño
-- ============================================================================
-- Nico, jul 2026: "que yolanda o lina registre ingresos y yo, que tengo acceso
-- a eso, registrar gastos".
--
-- El reparto no es caprichoso: Yolanda y Lina reciben plata en Nequi (por eso
-- cargan ingresos), pero quien tiene la app y saca la plata es el dueño. Un
-- gasto de Nequi cargado por un colaborador sería un movimiento que nadie
-- puede respaldar contra la app.
--
-- Se valida en la BASE y no solo en la UI: ocultar el botón no impide un
-- insert directo, y esto define cuánto tiene que haber en una cuenta real.
--
-- El efectivo NO cambia: ahí los colaboradores siguen cargando gastos como
-- siempre (es la caja física que manejan ellos).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.petty_cash_guard_nequi_gasto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- Solo aplica a egresos de la caja Nequi.
  IF NEW.cuenta IS DISTINCT FROM 'nequi' THEN
    RETURN NEW;
  END IF;
  IF NEW.kind = 'ingreso_efectivo' THEN
    RETURN NEW;
  END IF;

  v_owner := public.current_data_owner();

  -- current_data_owner() = auth.uid() solo para el dueño de la cuenta.
  -- Para un colaborador devuelve el id del dueño que lo invitó.
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Los gastos de la caja Nequi solo los puede registrar el dueño de la cuenta. Registrá el ingreso, o cargá el gasto como efectivo si salió de la caja física.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS petty_cash_guard_nequi_gasto_trg ON public.petty_cash_movements;
CREATE TRIGGER petty_cash_guard_nequi_gasto_trg
  BEFORE INSERT OR UPDATE ON public.petty_cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.petty_cash_guard_nequi_gasto();

COMMENT ON FUNCTION public.petty_cash_guard_nequi_gasto() IS
  'Rechaza egresos con cuenta=nequi cuando el caller no es el dueño de la cuenta. Los ingresos a Nequi los puede cargar cualquier colaborador.';

NOTIFY pgrst, 'reload schema';
