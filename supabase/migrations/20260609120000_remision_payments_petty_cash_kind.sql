-- Permite conciliar remisiones (Modo Gerencial) contra INGRESOS DE CAJA MENOR,
-- además de banco y efectivo. Caja menor ("Yolis") funciona como un efectivo
-- paralelo: entran pagos que luego se descuentan y a veces no se legalizan.
--
-- Antes: payment_kind ∈ ('bank','cash'). payment_id apunta a transactions.id
-- (bank) o cash_movements.id (cash).
-- Ahora: se agrega 'petty_cash' → payment_id apunta a petty_cash_movements.id.
--
-- Cambio ADITIVO y seguro: solo amplía los valores permitidos del CHECK. No
-- toca filas existentes ni datos. RLS de la tabla queda intacta.

ALTER TABLE public.remision_payments
  DROP CONSTRAINT IF EXISTS remision_payments_payment_kind_check;

ALTER TABLE public.remision_payments
  ADD CONSTRAINT remision_payments_payment_kind_check
  CHECK (payment_kind IN ('bank', 'cash', 'petty_cash'));

COMMENT ON TABLE public.remision_payments IS 'Vincula remisiones con pagos reales. payment_id apunta a transactions.id (bank), cash_movements.id (cash) o petty_cash_movements.id (petty_cash) segun payment_kind. amount_assigned permite dividir un pago entre multiples remisiones.';
