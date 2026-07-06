-- Regla de flujo en importaciones: una etapa POSTERIOR al estado actual no
-- puede tener fecha registrada.
--
-- Bug real: el mapeo legacy de fecha_arribo_real creaba una fila 'entregado'
-- (mayo) en el historial de un contenedor que sigue EN TRÁNSITO → la etapa en
-- curso mostraba 0 días y el total quedaba congelado en 34d cuando iban ~64.
-- La app ya aplica la regla (valida orden cronológico, bloquea fechas de
-- etapas futuras, limpia el historial al cambiar de estado); esta migración
-- corrige los datos que ya quedaron mal guardados.

WITH orden AS (
  SELECT t.estado, t.pos
  FROM unnest(ARRAY['cotizacion', 'produccion', 'transito', 'aduana', 'entregado'])
    WITH ORDINALITY AS t(estado, pos)
)
DELETE FROM public.import_estado_history h
USING public.imports i, orden oh, orden oi
WHERE h.import_id = i.id
  AND oh.estado = h.estado
  AND oi.estado = i.estado
  AND oh.pos > oi.pos;

-- fecha_arribo_real solo tiene sentido en pedidos entregados — en los demás
-- era la fuente del 'entregado' fantasma (el modal la mapeaba al historial).
UPDATE public.imports
SET fecha_arribo_real = NULL
WHERE estado IN ('cotizacion', 'anticipo', 'produccion', 'transito', 'aduana')
  AND fecha_arribo_real IS NOT NULL;
