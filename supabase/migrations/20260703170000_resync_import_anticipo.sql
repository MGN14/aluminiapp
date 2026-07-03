-- Reparación one-time: re-sincronizar imports.anticipo_pagado_usd desde los
-- abonos reales (import_payments).
--
-- El bug (ya arreglado en frontend): el modal de edición enviaba
-- anticipo_pagado_usd con el valor cargado AL ABRIR; si agregabas un abono
-- adentro y guardabas, el update pisaba el valor que el trigger había
-- calculado. Resultado: abono de USD 58.005 guardado en import_payments pero
-- anticipo en imports congelado en 27.639 → saldo inflado en la lista.
--
-- Idempotente: solo toca filas cuyo anticipo difiere de la suma real.
-- saldo_pendiente_usd es columna generada → se recalcula sola.

UPDATE public.imports i
SET anticipo_pagado_usd = COALESCE(
  (SELECT SUM(p.amount_usd) FROM public.import_payments p WHERE p.import_id = i.id),
  0
)
WHERE i.anticipo_pagado_usd IS DISTINCT FROM COALESCE(
  (SELECT SUM(p.amount_usd) FROM public.import_payments p WHERE p.import_id = i.id),
  0
);
