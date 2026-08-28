-- Caja menor: RETIRO de efectivo — sacar plata sin que sea un gasto.
--
-- Caso real (Nico, 2026-08-24, cerrando agosto): Yolanda le entrega el
-- efectivo de la caja — parte son cobros de clientes que ella recibió, parte
-- el sobrante — y él se lo lleva para asegurarlo, dejando en la caja solo el
-- fondo que ella necesita para gastos. Los únicos egresos disponibles eran
-- 'gasto_efectivo' y 'cuenta_de_cobro': ambos van al P&G como gasto, así que
-- registrar el retiro inflaba los gastos del mes con plata que nadie gastó.
--
-- 'retiro_efectivo' es el equivalente en caja del "traspaso" que ya existe en
-- la conciliación bancaria: mueve plata, no la consume.
--   · Baja el saldo de la caja (como cualquier egreso).
--   · NO entra al P&G, ni como gasto ni como ingreso.
--   · Si el dueño consigna ese efectivo, el depósito aparece en el extracto y
--     allí se marca como traspaso — así la plata no se cuenta dos veces.
--
-- Los cobros de clientes que Yolanda recibió en efectivo son otra cosa y
-- siguen registrándose como 'ingreso_efectivo' (esos SÍ son ingreso y cruzan
-- cartera del cliente por beneficiario).

ALTER TABLE public.petty_cash_movements
  DROP CONSTRAINT IF EXISTS petty_cash_movements_kind_check;

ALTER TABLE public.petty_cash_movements
  ADD CONSTRAINT petty_cash_movements_kind_check
  CHECK (kind IN ('gasto_efectivo', 'cuenta_de_cobro', 'ingreso_efectivo', 'retiro_efectivo'));

COMMENT ON COLUMN public.petty_cash_movements.kind IS
  'gasto_efectivo: egreso simple sin documento. cuenta_de_cobro: egreso con cuenta de cobro emitida por proveedor. ingreso_efectivo: entrada de efectivo (cobro a cliente, devolución, ingreso misceláneo). retiro_efectivo: salida de efectivo que NO es gasto (el dueño se lleva la plata para asegurarla o consignarla) — baja el saldo de la caja pero no toca el P&G.';

NOTIFY pgrst, 'reload schema';
