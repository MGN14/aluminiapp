-- Facturas de compra automáticas: backfill por ZIP/XML + buzón de email.
--
-- 1) invoices.source acepta 'xml' (uploader masivo determinístico) y
--    'email' (buzón facturas@aluminiapp.com vía Cloudflare Email Worker).
-- 2) Índice único parcial (user_id, cufe) — dedupe duro por CUFE. Defensivo:
--    si producción ya tiene CUFEs duplicados, NO se crea (solo warning) y el
--    dedupe queda a cargo de la app, que ya consulta antes de insertar.
-- 3) inbound_invoice_addresses — mapea dirección receptora → user dueño.
--    v1 single-tenant (facturas@aluminiapp.com → founder), pero la tabla deja
--    listo el multi-tenant (facturas+cliente@ → otro user) sin tocar código.

-- 1) source: 'manual' | 'siigo' | 'xml' | 'email'
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_source_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_source_check
  CHECK (source IN ('manual', 'siigo', 'xml', 'email'));

COMMENT ON COLUMN public.invoices.source IS
  'Origen de la factura: manual (upload PDF con IA), siigo (sync API), xml (import masivo ZIP/XML determinístico), email (buzón facturas@aluminiapp.com).';

-- 2) Dedupe duro por CUFE, por usuario
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT user_id, cufe
    FROM public.invoices
    WHERE cufe IS NOT NULL AND cufe <> ''
    GROUP BY user_id, cufe
    HAVING count(*) > 1
  ) t;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_user_cufe
      ON public.invoices (user_id, cufe)
      WHERE cufe IS NOT NULL AND cufe <> '';
  ELSE
    RAISE WARNING
      'uq_invoices_user_cufe NO creado: existen % pares (user_id, cufe) duplicados. Limpialos y recreá el índice; mientras tanto el dedupe lo hace la app.',
      dup_count;
  END IF;
END $$;

-- 3) Mapeo dirección de buzón → usuario dueño
CREATE TABLE IF NOT EXISTS public.inbound_invoice_addresses (
  address text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inbound_invoice_addresses IS
  'Direcciones del buzón receptor de facturas (Cloudflare Email Routing → edge function receive-purchase-invoice). address en minúsculas.';

-- Solo la edge function (service_role) la lee: RLS on sin policies = negado
-- para anon/authenticated, service_role la salta.
ALTER TABLE public.inbound_invoice_addresses ENABLE ROW LEVEL SECURITY;

-- Seed v1 single-tenant: el buzón oficial apunta al founder.
INSERT INTO public.inbound_invoice_addresses (address, user_id)
SELECT 'facturas@aluminiapp.com', id
FROM auth.users
WHERE email = 'niko14_gomez@hotmail.com'
ON CONFLICT (address) DO NOTHING;
