-- Permite que una regla de conciliación ("regla de Nico") setee también
-- transactions.movement_nature al matchear (además de category_id / responsible_id).
--
-- Caso de uso: auto-marcar el "PAGO TARJETA" de la cuenta bancaria como
-- 'traspaso' para que NO cuente como gasto en el P&G (isOperativo() lo excluye).
-- Así evitamos el doble conteo con las compras de la tarjeta (que ya entran como
-- gasto por el uploader de tarjeta de crédito).
ALTER TABLE public.reconciliation_rules
  ADD COLUMN IF NOT EXISTS movement_nature text
  CHECK (
    movement_nature IS NULL OR
    movement_nature IN ('operativo', 'traspaso', 'devolucion', 'prestamo', 'aporte')
  );

COMMENT ON COLUMN public.reconciliation_rules.movement_nature IS
  'Si no es NULL, la regla setea transactions.movement_nature al matchear. Ej: traspaso para "PAGO TARJETA" → excluido del P&G por isOperativo().';
