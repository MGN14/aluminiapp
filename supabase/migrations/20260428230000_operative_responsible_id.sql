-- Cartera Operativa fix: separar el beneficiario operativo del responsible_id de DIAN.
--
-- Problema: si la asignacion a Cartera Operativa setea responsible_id, la
-- transaccion deja de estar en "Pendientes" del Dashboard/Conciliacion (que
-- filtra por responsible_id IS NULL). Eso es incorrecto: legalmente sigue
-- sin factura, debe seguir pendiente.
--
-- Solucion: nueva columna operative_responsible_id, independiente de
-- responsible_id. Una transaccion puede tener:
--   - responsible_id = X, operative_responsible_id = NULL  (DIAN asignado)
--   - responsible_id = NULL, operative_responsible_id = X  (operativa cazada, DIAN pendiente)
--   - ambos seteados
--   - ninguno
--
-- Migration aditiva, no destructiva.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS operative_responsible_id uuid REFERENCES public.responsibles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transactions_operative_responsible_idx
  ON public.transactions(user_id, operative_responsible_id)
  WHERE operative_receivable_assigned = true;

COMMENT ON COLUMN public.transactions.operative_responsible_id IS 'Beneficiario para Cartera Operativa (Modulo Gerencial). Independiente de responsible_id (conciliacion DIAN). Setearlo NO afecta el estado de "pendiente DIAN" de la transaccion.';
