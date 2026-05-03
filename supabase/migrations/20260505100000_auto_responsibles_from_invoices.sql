-- Migration: auto-crear responsibles faltantes desde facturas existentes.
--
-- Problema: las facturas Siigo entraron históricamente con responsible_id=NULL
-- y counterparty_name="PROVIDENCE GROUP S.A.S" (o similar). El cliente real
-- nunca se creó en la tabla responsibles, por eso no aparece en Ajustes →
-- "A quién le pagas" ni se puede usar en filtros, conciliación bancaria, etc.
--
-- Esta migration recorre los counterparty_name únicos sin responsible asignado
-- y crea el responsible faltante. También crea el alias canónico y vincula
-- las facturas al nuevo responsible_id.
--
-- Idempotente: si el responsible ya existe (por nombre normalizado), NO se
-- duplica — la siguiente UPDATE simplemente vincula las facturas.

-- 1) Crear responsibles faltantes
INSERT INTO public.responsibles (user_id, name, nit, active, responsible_type)
SELECT DISTINCT
  i.user_id,
  trim(i.counterparty_name),
  i.counterparty_nit,
  true,
  'banking'
FROM public.invoices i
WHERE i.responsible_id IS NULL
  AND i.type = 'venta'
  AND i.counterparty_name IS NOT NULL
  AND length(trim(i.counterparty_name)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.responsibles r
    WHERE r.user_id = i.user_id
      AND lower(trim(r.name)) = lower(trim(i.counterparty_name))
  );

-- 2) Crear alias canónico para los responsibles recién creados
INSERT INTO public.responsible_aliases (user_id, responsible_id, alias, source)
SELECT user_id, id, name, 'auto-detected'
FROM public.responsibles
ON CONFLICT (user_id, lower(trim(alias))) DO NOTHING;

-- 3) Backfill invoices.responsible_id por nombre exacto (case-insensitive)
UPDATE public.invoices i
SET responsible_id = r.id
FROM public.responsibles r
WHERE i.user_id = r.user_id
  AND i.responsible_id IS NULL
  AND i.counterparty_name IS NOT NULL
  AND lower(trim(i.counterparty_name)) = lower(trim(r.name))
  AND r.active = true;

-- 4) Diagnóstico
DO $$
DECLARE
  v_responsibles_total int;
  v_invoices_with_resp int;
  v_invoices_null int;
  v_aliases_count int;
BEGIN
  SELECT COUNT(*) INTO v_responsibles_total FROM public.responsibles WHERE active = true;
  SELECT COUNT(*) INTO v_invoices_with_resp FROM public.invoices WHERE responsible_id IS NOT NULL;
  SELECT COUNT(*) INTO v_invoices_null FROM public.invoices WHERE responsible_id IS NULL;
  SELECT COUNT(*) INTO v_aliases_count FROM public.responsible_aliases;

  RAISE NOTICE 'Auto-responsibles: total responsibles activos = %', v_responsibles_total;
  RAISE NOTICE 'Auto-responsibles: invoices con responsible_id = %', v_invoices_with_resp;
  RAISE NOTICE 'Auto-responsibles: invoices SIN responsible_id (NULL) = %', v_invoices_null;
  RAISE NOTICE 'Auto-responsibles: aliases creados = %', v_aliases_count;
END $$;
