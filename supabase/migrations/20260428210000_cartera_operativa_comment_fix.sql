-- Cartera Operativa: actualizar COMMENT de operative_receivable_assigned.
-- La columna NO es excluyente con invoice_id: una transaccion puede tener
-- invoice_id NULL (sigue pendiente DIAN) y operative_receivable_assigned=true
-- al mismo tiempo. Caso de uso: pago bancario de cliente conocido sin factura
-- emitida todavia, asignado a Cartera Operativa para descontar deuda.

COMMENT ON COLUMN public.transactions.operative_receivable_assigned IS 'true cuando este pago bancario se asigna explicitamente a cartera operativa del responsible. Puede coexistir con invoice_id NULL (pendiente DIAN) o invoice_id NOT NULL (facturado, gestion del usuario).';
