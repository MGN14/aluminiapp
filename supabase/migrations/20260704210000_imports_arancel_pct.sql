-- % de arancel configurable por importación (default 5% — perfilería de
-- aluminio). Base del costeo estimado: arancel = (mercancía + flete) en COP
-- × arancel_pct; IVA importación = 19% × (CIF COP + arancel). El IVA es
-- descontable (no va a costeo) pero afecta caja.
ALTER TABLE public.imports
  ADD COLUMN IF NOT EXISTS arancel_pct numeric(5, 2) NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.imports.arancel_pct IS
  'Porcentaje de arancel estimado para el costeo (default 5). Configurable por pedido según la partida arancelaria.';
