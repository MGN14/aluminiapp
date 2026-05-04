-- Granularizar el permiso 'reportes' en 6 reportes individuales.
-- Antes: una sola key 'reportes' daba acceso a Estado de resultados, Anticipos,
-- Lo que me deben, Lo que debo, Flujo de caja y Relación de pagos en bloque.
-- Ahora: cada reporte tiene su propia key para que el admin escoja por reporte.
--
-- Estrategia idempotente:
-- 1. Por cada fila con module_key='reportes', insertar 6 filas nuevas con el
--    mismo access_level. ON CONFLICT DO NOTHING evita pisar permisos que el
--    admin ya haya configurado individualmente.
-- 2. Borrar las filas viejas con module_key='reportes'.
-- En una segunda corrida no hay filas 'reportes' → no inserta ni borra nada.

INSERT INTO public.collaborator_permissions (collaborator_id, module_key, access_level)
SELECT cp.collaborator_id, k.new_key, cp.access_level
FROM public.collaborator_permissions cp
CROSS JOIN (VALUES
  ('estado_resultados'),
  ('anticipos'),
  ('cuentas_por_cobrar'),
  ('cuentas_por_pagar'),
  ('flujo_caja'),
  ('relacion_pagos')
) AS k(new_key)
WHERE cp.module_key = 'reportes'
ON CONFLICT (collaborator_id, module_key) DO NOTHING;

DELETE FROM public.collaborator_permissions WHERE module_key = 'reportes';
