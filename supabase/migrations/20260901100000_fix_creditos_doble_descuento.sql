-- ============================================================================
-- Fix doble descuento de cuotas de crédito al conciliar el extracto
-- (reporte Nico 2026-09-01: registró la cuota a mano, al conciliar el débito
--  la app insertó OTRO pago, y como la fila seguía "Pendiente" dio clic dos
--  veces → quedaron "pagadas" las cuotas de septiembre y octubre).
--
-- 1) Deduplica pagos colgando de la MISMA transacción bancaria (doble clic).
-- 2) Borra el pago creado por la conciliación que duplica un pago manual del
--    mismo débito; el manual hereda el vínculo con la transacción.
-- 3) Revive créditos que quedaron "paid" por el descuento fantasma.
-- 4) Candado permanente: un movimiento bancario respalda máximo UN pago.
-- ============================================================================

-- 1. Varios pagos respaldados por la MISMA transacción bancaria (doble clic):
--    se conserva el más antiguo.
DELETE FROM public.credit_payments cp
USING public.credit_payments keep
WHERE cp.transaction_id IS NOT NULL
  AND keep.transaction_id = cp.transaction_id
  AND keep.id <> cp.id
  AND (keep.created_at < cp.created_at
       OR (keep.created_at = cp.created_at AND keep.id < cp.id));

-- 2. Pagos nacidos de la conciliación que duplican un pago manual del mismo
--    crédito (monto ±15%, fecha ±20 días — la cuota del mes vecino queda a
--    ~30 días, no entra). Emparejamiento 1-a-1: cada manual absorbe máximo un
--    pago de conciliación (si hubiera dos débitos reales distintos, el
--    segundo se conserva). El manual hereda el transaction_id del borrado.
WITH pairs AS (
  SELECT cp.id AS conc_id,
         cp.transaction_id,
         m.id  AS manual_id,
         ROW_NUMBER() OVER (
           PARTITION BY m.id
           ORDER BY ABS(m.payment_date - cp.payment_date) ASC,
                    ABS(m.amount_paid - cp.amount_paid) ASC,
                    cp.created_at ASC
         ) AS rn_por_manual,
         ROW_NUMBER() OVER (
           PARTITION BY cp.id
           ORDER BY ABS(m.payment_date - cp.payment_date) ASC,
                    ABS(m.amount_paid - cp.amount_paid) ASC
         ) AS rn_por_conc
  FROM public.credit_payments cp
  JOIN public.credit_payments m
    ON m.credit_id = cp.credit_id
   AND m.id <> cp.id
   AND m.transaction_id IS NULL
   AND m.is_extra = false
   AND ABS(m.amount_paid - cp.amount_paid) <= cp.amount_paid * 0.15
   AND ABS(m.payment_date - cp.payment_date) <= 20
  WHERE cp.transaction_id IS NOT NULL
    AND cp.is_extra = false
    AND cp.notes LIKE 'Conciliado desde extracto%'
),
best AS (
  SELECT conc_id, transaction_id, manual_id
  FROM pairs
  WHERE rn_por_manual = 1 AND rn_por_conc = 1
),
deleted AS (
  DELETE FROM public.credit_payments cp
  USING best b
  WHERE cp.id = b.conc_id
  RETURNING b.transaction_id, b.manual_id
)
UPDATE public.credit_payments m
SET transaction_id = d.transaction_id
FROM deleted d
WHERE m.id = d.manual_id
  AND m.transaction_id IS NULL;

-- 3. Créditos marcados "paid" por el doble descuento pero con saldo real:
--    vuelven a activos.
UPDATE public.credits c
SET status = 'active'
WHERE c.status = 'paid'
  AND c.principal - COALESCE((
        SELECT SUM(p.principal_paid)
        FROM public.credit_payments p
        WHERE p.credit_id = c.id
      ), 0) > 0.5;

-- 4. Candado: una transacción bancaria respalda máximo UN pago de crédito.
--    El frontend además adopta el pago manual existente en vez de insertar,
--    pero este índice corta cualquier carrera de doble clic a nivel de datos.
CREATE UNIQUE INDEX IF NOT EXISTS credit_payments_transaction_unique
  ON public.credit_payments(transaction_id)
  WHERE transaction_id IS NOT NULL;
