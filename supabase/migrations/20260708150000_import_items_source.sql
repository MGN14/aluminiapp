-- Proforma vs Packing list definitivo en el MISMO pedido.
--
-- Flujo de Nico: al mandar a producción sube el PROFORMA (refs sin sufijo,
-- China no los maneja) para que cuente como cobertura; cuando llega el
-- PACKING LIST definitivo (refs con sufijo de color) lo sube también.
-- Con ambos guardados, la app agrupa por familia (-5) y muestra las
-- DIFERENCIAS proforma vs packing (siempre las hay) — y el costeo/cobertura
-- usan el definitivo cuando existe, si no el proforma.

ALTER TABLE public.import_items
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'packing';

DO $$ BEGIN
  ALTER TABLE public.import_items
    ADD CONSTRAINT import_items_source_chk CHECK (source IN ('proforma', 'packing'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.import_items.source IS
  'proforma = pedido mandado a produccion (sin sufijos); packing = packing list definitivo. El costeo y la cobertura usan packing si existe, si no proforma.';
