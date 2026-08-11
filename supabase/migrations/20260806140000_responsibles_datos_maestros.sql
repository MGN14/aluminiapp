-- Módulo TERCEROS (Nico, 2026-08-06): completar los datos maestros de
-- `responsibles` para que la ficha 360° tenga qué mostrar.
--
-- `responsibles` ya es la tabla única de terceros (no hay clients/suppliers
-- separadas) y trae name, nit, tipo_documento, tipo_persona, ciudad,
-- telefono, email, phone, address. Faltan los campos "de RUT" y los
-- comerciales. Todos OPCIONALES: nada se rompe si están vacíos.
--
-- `responsible_type` (banking/petty_cash/both) NO se toca: define en qué
-- módulos aparece el tercero, no qué ES. El rol (cliente/proveedor/empleado/
-- entidad) se DERIVA de sus movimientos en src/lib/terceroProfile.ts.

ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS razon_social text,
  ADD COLUMN IF NOT EXISTS dv smallint CHECK (dv IS NULL OR (dv >= 0 AND dv <= 9)),
  ADD COLUMN IF NOT EXISTS regimen text
    CHECK (regimen IS NULL OR regimen IN ('simple', 'comun', 'no_responsable_iva', 'gran_contribuyente')),
  ADD COLUMN IF NOT EXISTS actividad_economica text,
  ADD COLUMN IF NOT EXISTS notas text,
  ADD COLUMN IF NOT EXISTS dias_credito integer CHECK (dias_credito IS NULL OR dias_credito >= 0),
  ADD COLUMN IF NOT EXISTS cupo_credito numeric CHECK (cupo_credito IS NULL OR cupo_credito >= 0);

COMMENT ON COLUMN public.responsibles.razon_social IS
  'Nombre legal cuando difiere del comercial (el que aparece en el RUT).';
COMMENT ON COLUMN public.responsibles.dv IS
  'Dígito de verificación del NIT (0-9).';
COMMENT ON COLUMN public.responsibles.regimen IS
  'simple | comun | no_responsable_iva | gran_contribuyente. Define retenciones aplicables.';
COMMENT ON COLUMN public.responsibles.actividad_economica IS
  'Código CIIU del RUT.';
COMMENT ON COLUMN public.responsibles.dias_credito IS
  'Plazo de pago pactado. Referencia para la cartera y el aging.';
COMMENT ON COLUMN public.responsibles.cupo_credito IS
  'Tope de crédito otorgado. Se contrasta contra el saldo pendiente en la ficha.';

-- Búsqueda por NIT desde el listado de Terceros.
CREATE INDEX IF NOT EXISTS responsibles_user_nit_idx
  ON public.responsibles(user_id, nit)
  WHERE nit IS NOT NULL;

NOTIFY pgrst, 'reload schema';
