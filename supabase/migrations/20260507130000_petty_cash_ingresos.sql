-- Permitir registrar ingresos en Caja Menor (no solo egresos).
-- El check constraint original limitaba kind a {gasto_efectivo, cuenta_de_cobro};
-- agregamos 'ingreso_efectivo' para que el founder y los colaboradores puedan
-- registrar entradas de efectivo (devoluciones, ingresos misceláneos, etc.).

ALTER TABLE public.petty_cash_movements
  DROP CONSTRAINT IF EXISTS petty_cash_movements_kind_check;

ALTER TABLE public.petty_cash_movements
  ADD CONSTRAINT petty_cash_movements_kind_check
  CHECK (kind IN ('gasto_efectivo', 'cuenta_de_cobro', 'ingreso_efectivo'));

COMMENT ON COLUMN public.petty_cash_movements.kind IS
  'gasto_efectivo: egreso simple sin documento. cuenta_de_cobro: egreso con cuenta de cobro emitida por proveedor. ingreso_efectivo: entrada de efectivo (devolución, ingreso misceláneo).';
