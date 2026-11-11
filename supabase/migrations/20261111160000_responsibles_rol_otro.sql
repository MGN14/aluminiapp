-- Rol "Otro" para terceros que no son cliente, proveedor, empleado ni entidad.
--
-- Pedido de Nico (2026-11-11): el tercero "Otros" y los coteros no encajan
-- en ningún rol, y el editor no dejaba guardar sin escoger uno (a "Otros"
-- le había quedado "Entidad" por descarte). 'otro' se fija solo a mano y va
-- solo; la app lo hace excluyente. Solo cambia la lista permitida del CHECK:
-- no toca datos.
ALTER TABLE public.responsibles
  DROP CONSTRAINT IF EXISTS responsibles_roles_manual_validos;

ALTER TABLE public.responsibles
  ADD CONSTRAINT responsibles_roles_manual_validos
  CHECK (
    roles_manual IS NULL
    OR roles_manual <@ ARRAY['cliente', 'proveedor', 'empleado', 'entidad', 'otro']::text[]
  );

COMMENT ON COLUMN public.responsibles.roles_manual IS
  'Roles fijados a mano (cliente, proveedor, empleado, entidad, otro). NULL = automático: el rol se deriva de la actividad del tercero. otro = no encaja en ninguno.';
