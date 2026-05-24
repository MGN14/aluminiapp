-- Comprobantes de Ingreso (Recibos de Caja)
-- Documento que se entrega al cliente cuando RECIBES un pago.
-- Análogo a "cuenta de cobro" pero invertido: aquí no estás cobrando,
-- estás dando constancia de que recibiste el dinero.
--
-- Soporta dos formatos de PDF:
--   - use_letterhead = true  → con membrete de empresa (profile.letterhead_path)
--   - use_letterhead = false → formato limpio sin membrete (solo encabezado del recibo)
--
-- Numeración auto: RC-YYYY-NNNN (Recibo de Caja), consecutiva por usuario por año.

CREATE TABLE IF NOT EXISTS public.income_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  numero_consecutivo text NULL, -- auto-asignado por trigger: RC-YYYY-NNNN
  fecha date NOT NULL DEFAULT CURRENT_DATE,

  -- Pagador (quien te dio el dinero)
  payer_responsible_id uuid NULL REFERENCES public.responsibles(id) ON DELETE SET NULL,
  payer_name text NOT NULL,
  payer_document text NULL,        -- NIT o CC
  payer_document_type text NULL,   -- 'CC' | 'CE' | 'NIT' | 'PA'
  payer_address text NULL,
  payer_city text NULL,
  payer_phone text NULL,

  -- Detalle del pago
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  concept text NOT NULL,           -- e.g. "Abono factura FV-001"
  payment_method text NULL,        -- 'efectivo' | 'transferencia' | 'cheque' | 'wompi' | ...
  reference_doc text NULL,         -- e.g. número de factura asociada, o referencia de transferencia
  notes text NULL,

  -- Formato del PDF
  use_letterhead boolean NOT NULL DEFAULT true,

  -- Opcional: vincular a una factura existente
  invoice_id uuid NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS income_receipts_user_idx
  ON public.income_receipts(user_id, fecha DESC);
CREATE INDEX IF NOT EXISTS income_receipts_payer_idx
  ON public.income_receipts(user_id, payer_responsible_id)
  WHERE payer_responsible_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS income_receipts_consecutivo_user_unique
  ON public.income_receipts(user_id, numero_consecutivo)
  WHERE numero_consecutivo IS NOT NULL;

COMMENT ON TABLE public.income_receipts IS
  'Comprobantes de ingreso (recibos de caja) emitidos a clientes. PDF con/sin membrete según use_letterhead.';

ALTER TABLE public.income_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "income_receipts_owner_select" ON public.income_receipts;
CREATE POLICY "income_receipts_owner_select"
  ON public.income_receipts FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "income_receipts_owner_insert" ON public.income_receipts;
CREATE POLICY "income_receipts_owner_insert"
  ON public.income_receipts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "income_receipts_owner_update" ON public.income_receipts;
CREATE POLICY "income_receipts_owner_update"
  ON public.income_receipts FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "income_receipts_owner_delete" ON public.income_receipts;
CREATE POLICY "income_receipts_owner_delete"
  ON public.income_receipts FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_income_receipts_updated_at ON public.income_receipts;
CREATE TRIGGER set_income_receipts_updated_at
  BEFORE UPDATE ON public.income_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- Trigger: numero_consecutivo automático con formato RC-YYYY-NNNN
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_income_receipt_consecutivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num int;
  year_str text;
BEGIN
  IF (NEW.numero_consecutivo IS NULL OR NEW.numero_consecutivo = '') THEN
    year_str := to_char(NEW.fecha, 'YYYY');
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(numero_consecutivo FROM ('RC-' || year_str || '-(\d+)$')) AS int)
    ), 0) + 1
    INTO next_num
    FROM public.income_receipts
    WHERE user_id = NEW.user_id
      AND numero_consecutivo IS NOT NULL
      AND numero_consecutivo ~ ('^RC-' || year_str || '-\d+$');
    NEW.numero_consecutivo := 'RC-' || year_str || '-' || lpad(next_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS income_receipts_consecutivo_trg ON public.income_receipts;
CREATE TRIGGER income_receipts_consecutivo_trg
  BEFORE INSERT ON public.income_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_income_receipt_consecutivo();
