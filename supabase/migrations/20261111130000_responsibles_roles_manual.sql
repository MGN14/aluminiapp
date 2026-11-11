-- Rol de un tercero fijado A MANO desde el listado de Terceros.
--
-- Hasta hoy el rol (cliente / proveedor / empleado / entidad) solo se
-- derivaba de la actividad. Pedido de Nico 2026-11-11: poder corregirlo con
-- un clic en el chip de la columna Rol ("hacer clic en Proveedor y cambiarlo
-- a las categorías existentes").
--
--   roles_manual NULL  → automático: el rol se deriva como siempre.
--   roles_manual {...} → esos roles MANDAN sobre lo derivado, en el listado,
--                        en la ficha y en el selector de beneficiario de las
--                        filas Ventas de Conciliación.
--
-- Generaliza a cliente_manual (20261111120000), que queda como columna
-- heredada: NO se borra (producción con clientes reales) y el código la
-- sigue leyendo para los terceros que aún no tengan roles_manual. El editor
-- nuevo mantiene las dos columnas en sincronía. El código tolera que esta
-- migración no esté aplicada (todo sigue en automático).
ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS roles_manual text[] NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'responsibles_roles_manual_validos'
  ) THEN
    ALTER TABLE public.responsibles
      ADD CONSTRAINT responsibles_roles_manual_validos
      CHECK (
        roles_manual IS NULL
        OR roles_manual <@ ARRAY['cliente', 'proveedor', 'empleado', 'entidad']::text[]
      );
  END IF;
END $$;

COMMENT ON COLUMN public.responsibles.roles_manual IS
  'Roles fijados a mano (cliente, proveedor, empleado, entidad). NULL = automático: el rol se deriva de la actividad del tercero.';
