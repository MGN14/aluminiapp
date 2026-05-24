-- Módulo Importaciones — Fase 2: registro de abonos con TRM.
--
-- Cada importación tiene N pagos. Cada pago se hace en USD pero se ejecuta
-- contra el banco a una TRM específica (TRM del día de la transacción).
-- Necesitamos saber:
--   - cuánto se pagó total en USD (para saber el saldo USD pendiente)
--   - cuánto costó en COP cada abono (USD × TRM)  → para liquidar costo real
--   - TRM promedio ponderada al liquidar
--
-- La columna imports.anticipo_pagado_usd se sincroniza con SUM(amount_usd)
-- vía trigger en import_payments. Así saldo_pendiente_usd (GENERATED) se
-- mantiene correcto sin que el frontend tenga que tocarlo.

CREATE TABLE IF NOT EXISTS public.import_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,

  fecha date NOT NULL,
  amount_usd numeric(14, 2) NOT NULL CHECK (amount_usd > 0),
  trm numeric(12, 4) NOT NULL CHECK (trm > 0),  -- COP por USD ese día

  -- Calculado: COP efectivamente movido del banco para este abono.
  amount_cop numeric(18, 2) GENERATED ALWAYS AS (
    ROUND(amount_usd * trm, 2)
  ) STORED,

  -- Tipo de abono: anticipo, parcial, saldo_final, otro. Solo informativo.
  tipo text NOT NULL DEFAULT 'parcial'
    CHECK (tipo IN ('anticipo', 'parcial', 'saldo_final', 'otro')),

  -- Referencia opcional al movimiento bancario / responsable que paga.
  notes text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_payments_import_idx
  ON public.import_payments(import_id, fecha);
CREATE INDEX IF NOT EXISTS import_payments_user_idx
  ON public.import_payments(user_id, fecha DESC);

COMMENT ON TABLE public.import_payments IS
  'Abonos a importaciones. Cada abono guarda su TRM del día para liquidar el costo real en COP.';

ALTER TABLE public.import_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_payments_owner_select" ON public.import_payments;
CREATE POLICY "import_payments_owner_select"
  ON public.import_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "import_payments_owner_insert" ON public.import_payments;
CREATE POLICY "import_payments_owner_insert"
  ON public.import_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "import_payments_owner_update" ON public.import_payments;
CREATE POLICY "import_payments_owner_update"
  ON public.import_payments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "import_payments_owner_delete" ON public.import_payments;
CREATE POLICY "import_payments_owner_delete"
  ON public.import_payments FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_import_payments_updated_at ON public.import_payments;
CREATE TRIGGER set_import_payments_updated_at
  BEFORE UPDATE ON public.import_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- Sincronización: imports.anticipo_pagado_usd = SUM(import_payments.amount_usd)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalc_import_anticipo_usd(p_import_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.imports
  SET anticipo_pagado_usd = COALESCE(
        (SELECT SUM(amount_usd) FROM public.import_payments WHERE import_id = p_import_id),
        0
      ),
      updated_at = NOW()
  WHERE id = p_import_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_import_anticipo_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_import_anticipo_usd(OLD.import_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.import_id IS DISTINCT FROM NEW.import_id THEN
    -- Cambió de import (raro, pero por si acaso): recalcular ambos.
    PERFORM public.recalc_import_anticipo_usd(OLD.import_id);
    PERFORM public.recalc_import_anticipo_usd(NEW.import_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_import_anticipo_usd(NEW.import_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS sync_import_anticipo ON public.import_payments;
CREATE TRIGGER sync_import_anticipo
  AFTER INSERT OR UPDATE OR DELETE ON public.import_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_import_anticipo_trg();

-- =============================================================================
-- View de liquidación: resumen por importación
-- =============================================================================

CREATE OR REPLACE VIEW public.imports_liquidation AS
SELECT
  i.id                                                                   AS import_id,
  i.user_id,
  i.proveedor_nombre,
  i.monto_total_usd,
  COALESCE(SUM(p.amount_usd), 0)::numeric(14,2)                          AS total_pagado_usd,
  COALESCE(SUM(p.amount_cop), 0)::numeric(18,2)                          AS total_pagado_cop,
  (COALESCE(i.monto_total_usd, 0) - COALESCE(SUM(p.amount_usd), 0))::numeric(14,2) AS saldo_pendiente_usd,
  CASE
    WHEN COALESCE(SUM(p.amount_usd), 0) > 0
    THEN ROUND(SUM(p.amount_cop) / SUM(p.amount_usd), 4)
    ELSE NULL
  END                                                                    AS trm_promedio_ponderada,
  COUNT(p.id)                                                            AS abonos_count,
  -- "Liquidada" cuando se cubrió todo el USD facturado
  (COALESCE(i.monto_total_usd, 0) > 0
   AND COALESCE(SUM(p.amount_usd), 0) >= i.monto_total_usd)              AS liquidada
FROM public.imports i
LEFT JOIN public.import_payments p ON p.import_id = i.id
GROUP BY i.id;

COMMENT ON VIEW public.imports_liquidation IS
  'Liquidación por importación: total USD/COP pagado, TRM promedio ponderada, saldo.';

-- La vista usa RLS de imports automáticamente (se reescribe a SELECT desde imports).
-- Ajuste explícito por si security_invoker no estuviera habilitado:
ALTER VIEW public.imports_liquidation SET (security_invoker = true);
