-- Estado 'listo_fabrica': contenedor TERMINADO en fábrica pero aún no
-- despachado (retenido a decisión del negocio).
--
-- Caso real (Nico, 2026-07-24): dos contenedores montados a la vez por baja
-- abrupta del SMM; 2026-3 termina producción pero NO se manda a traer hasta
-- recibir 2026-2. Sin este estado:
--   1. la "producción" de 2026-3 se inflaba con semanas de retención y
--      contaminaba el lead time promedio;
--   2. el motor de cobertura asumía flujo normal (producción restante +
--      tránsito) cuando en realidad ya solo falta tránsito + nacionalización
--      desde el día que se ordene el despacho.
--
-- Flujo: produccion → listo_fabrica → transito → aduana → entregado → cerrado.
-- La etapa listo_fabrica→transito (retención) se EXCLUYE de los promedios.

ALTER TABLE public.imports DROP CONSTRAINT IF EXISTS imports_estado_check;
ALTER TABLE public.imports ADD CONSTRAINT imports_estado_check
  CHECK (estado IN ('cotizacion', 'anticipo', 'produccion', 'listo_fabrica', 'transito', 'aduana', 'entregado', 'cerrado', 'cancelado'));

ALTER TABLE public.import_estado_history DROP CONSTRAINT IF EXISTS import_estado_history_estado_check;
ALTER TABLE public.import_estado_history ADD CONSTRAINT import_estado_history_estado_check
  CHECK (estado IN ('cotizacion', 'anticipo', 'produccion', 'listo_fabrica', 'transito', 'aduana', 'entregado', 'cerrado', 'cancelado'));
