-- Migration: cleanup de huérfanos + backfill responsible_id en facturas Siigo
--
-- Problema histórico: el edge function siigo-sync-invoices nunca populaba
-- invoices.responsible_id. Como resultado:
--   1. Facturas Siigo entraban con responsible_id=NULL
--   2. Reportes "Lo que me deben" / "Anticipos" hacían match por
--      counterparty_name ilike (string fragil) → falla cuando Siigo y
--      manual difieren mínimamente en el nombre
--   3. Si una factura era borrada y re-syncada, los anticipos vinculados
--      vía initial_state_details.invoice_id quedaban huérfanos
--
-- Esta migration es READ-ONLY → UPDATE: no destruye datos, solo conecta
-- referencias por NIT y limpia referencias a IDs inexistentes.

-- 1) Anticipos huérfanos: invoice_id apunta a factura ya borrada → poner NULL
--    para que el usuario pueda re-vincular desde el panel /reportes/anticipos
UPDATE public.initial_state_details
SET invoice_id = NULL
WHERE invoice_id IS NOT NULL
  AND invoice_id NOT IN (SELECT id FROM public.invoices);

-- 2) Backfill por NIT normalizado (solo dígitos, sin DV).
--    Aplica a TODAS las facturas con responsible_id NULL — no solo Siigo.
--    Esto cubre: facturas históricas Siigo + facturas manuales sin responsible.
UPDATE public.invoices i
SET responsible_id = r.id
FROM public.responsibles r
WHERE i.user_id = r.user_id
  AND i.responsible_id IS NULL
  AND i.counterparty_nit IS NOT NULL
  AND r.nit IS NOT NULL
  AND length(regexp_replace(i.counterparty_nit, '[^0-9]', '', 'g')) >= 6
  AND regexp_replace(i.counterparty_nit, '[^0-9]', '', 'g')
      = regexp_replace(r.nit, '[^0-9]', '', 'g')
  AND r.active = true;

-- 3) Backfill por nombre exacto (case-insensitive, trimmed) si NIT falló.
--    Solo para registros que siguen NULL después del paso 2.
UPDATE public.invoices i
SET responsible_id = r.id
FROM public.responsibles r
WHERE i.user_id = r.user_id
  AND i.responsible_id IS NULL
  AND i.counterparty_name IS NOT NULL
  AND lower(trim(i.counterparty_name)) = lower(trim(r.name))
  AND r.active = true;

-- 4) Diagnóstico: log cuántas filas quedan con responsible_id NULL después
--    del backfill — esto va a stderr en la corrida de db push.
DO $$
DECLARE
  v_total_invoices int;
  v_null_after int;
  v_orphan_anticipos int;
BEGIN
  SELECT COUNT(*) INTO v_total_invoices FROM public.invoices;
  SELECT COUNT(*) INTO v_null_after
    FROM public.invoices WHERE responsible_id IS NULL;
  SELECT COUNT(*) INTO v_orphan_anticipos
    FROM public.initial_state_details
    WHERE field_type = 'anticipos_de_clientes' AND invoice_id IS NULL;

  RAISE NOTICE 'Cleanup Siigo orphans: total invoices = %', v_total_invoices;
  RAISE NOTICE 'Cleanup Siigo orphans: invoices con responsible_id NULL tras backfill = %', v_null_after;
  RAISE NOTICE 'Cleanup Siigo orphans: anticipos sin invoice_id (disponibles para re-vincular) = %', v_orphan_anticipos;
END $$;
