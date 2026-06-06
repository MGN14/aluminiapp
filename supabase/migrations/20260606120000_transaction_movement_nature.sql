-- ============================================================================
-- Naturaleza del movimiento (movement_nature) en transactions
-- ============================================================================
-- Hoy una transacción solo se clasifica por category (report_group) + type
-- (ingreso/egreso) + responsible. No hay forma de marcar que un ingreso NO es
-- venta real (un traspaso entre cuentas, una devolución de la DIAN, un préstamo
-- o un aporte de socio). Por eso esos movimientos inflan ingresos y la DIAN
-- aparecía como "cliente".
--
-- Esta columna se setea en CONCILIACIÓN y la respetan TODOS los cálculos
-- (P&G, dashboard, cashflow, health y la API):
--   operativo (o NULL) = ingreso/egreso REAL del negocio (default).
--   traspaso           = movimiento entre cuentas propias (no es plata nueva).
--   devolucion         = devolución / reintegro (ej. DIAN) — no es venta.
--   prestamo           = financiación recibida/pagada — no es ingreso/gasto.
--   aporte             = aporte de socio — es patrimonio, no ingreso.
--
-- NULL = operativo → no cambia ningún número hasta que el usuario etiquete.
-- NO destructivo, NO toca vínculos.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS movement_nature text
  CHECK (
    movement_nature IS NULL OR
    movement_nature IN ('operativo', 'traspaso', 'devolucion', 'prestamo', 'aporte')
  );

COMMENT ON COLUMN public.transactions.movement_nature IS
  'Naturaleza del movimiento (se setea en conciliación). NULL/operativo = ingreso/egreso real; traspaso/devolucion/prestamo/aporte NO cuentan como operativo. Respetado por P&G, dashboard, cashflow, health y el MCP.';

CREATE INDEX IF NOT EXISTS idx_transactions_movement_nature
  ON public.transactions(user_id, movement_nature)
  WHERE movement_nature IS NOT NULL AND movement_nature <> 'operativo';
