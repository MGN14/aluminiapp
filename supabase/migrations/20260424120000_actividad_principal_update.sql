-- ─────────────────────────────────────────────────────────────────────────────
-- Update `fiscal_config.actividad_principal` enum values to the new taxonomy.
--
-- Antes: 'comercial' | 'servicios' | 'industrial' | 'construccion' | 'otro'
-- Después: 'distribuidor' | 'fabricante' | 'servicios' | 'construccion' | 'mixto'
--
-- Mapeo de valores existentes:
--   comercial    → distribuidor
--   industrial   → fabricante
--   otro         → mixto
--   servicios    → servicios (sin cambio)
--   construccion → construccion (sin cambio)
--
-- Backup: se copian las filas afectadas a _backup_fiscal_config_actividad.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Backup de filas con actividad_principal no nula (por si hay que revertir)
CREATE TABLE IF NOT EXISTS _backup_fiscal_config_actividad (
  id             UUID,
  user_id        UUID,
  actividad_old  TEXT,
  backed_up_at   TIMESTAMPTZ DEFAULT now()
);

INSERT INTO _backup_fiscal_config_actividad (id, user_id, actividad_old)
SELECT id, user_id, actividad_principal
FROM fiscal_config
WHERE actividad_principal IS NOT NULL;

-- 2. Quitar el CHECK antiguo para poder escribir valores nuevos
ALTER TABLE fiscal_config
  DROP CONSTRAINT IF EXISTS fiscal_config_actividad_principal_check;

-- 3. Remapear valores existentes
UPDATE fiscal_config SET actividad_principal = 'distribuidor' WHERE actividad_principal = 'comercial';
UPDATE fiscal_config SET actividad_principal = 'fabricante'   WHERE actividad_principal = 'industrial';
UPDATE fiscal_config SET actividad_principal = 'mixto'        WHERE actividad_principal = 'otro';

-- 4. Recrear CHECK con los valores nuevos
ALTER TABLE fiscal_config
  ADD CONSTRAINT fiscal_config_actividad_principal_check
  CHECK (actividad_principal IN ('distribuidor', 'fabricante', 'servicios', 'construccion', 'mixto'));

-- 5. Refrescar el schema de PostgREST para que el API vea los cambios
NOTIFY pgrst, 'reload schema';

COMMIT;
