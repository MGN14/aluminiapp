-- Migration: acoplar AluminIA a Siigo como source of truth + sistema de aliases.
--
-- Antes:
--   - "Lo que me deben" calculaba saldo desde invoice_transaction_matches
--     (vinculaciones manuales factura↔pago bancario), que se rompían cuando
--     Siigo re-creaba facturas con UUID nuevo
--   - Los nombres de clientes variaban entre Siigo y el extracto bancario
--     (ej: "ALUMINIOS DEL EJE" vs "Aluminios JH"), rompiendo el match auto
--
-- Ahora:
--   - invoices.balance_pending = saldo Siigo (fuente única, siempre fresco)
--   - responsible_aliases = nombres alternativos por cliente para matching robusto

-- 1) Columna balance_pending en invoices ── source of truth desde Siigo
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS balance_pending numeric;

COMMENT ON COLUMN public.invoices.balance_pending IS
  'Saldo pendiente según Siigo (= total_amount - lo que ya cobraste). Source of truth para "Lo que me deben". Si NULL, fallback a cálculo desde invoice_transaction_matches (compat con facturas manuales pre-Siigo).';

CREATE INDEX IF NOT EXISTS idx_invoices_balance_pending
  ON public.invoices(user_id, balance_pending)
  WHERE balance_pending IS NOT NULL AND balance_pending > 0;

-- 2) Tabla responsible_aliases ── un cliente, varios nombres alternativos
CREATE TABLE IF NOT EXISTS public.responsible_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  responsible_id uuid NOT NULL REFERENCES public.responsibles(id) ON DELETE CASCADE,
  alias text NOT NULL,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'siigo', 'auto-detected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique: el mismo alias no puede vivir dos veces para el mismo user
-- (case-insensitive, trimmed). Permite "Aluminios JH" y "ALUMINIOS DEL EJE"
-- mapeen al mismo responsible, pero no dos veces el mismo string.
CREATE UNIQUE INDEX IF NOT EXISTS idx_responsible_aliases_unique
  ON public.responsible_aliases(user_id, lower(trim(alias)));

CREATE INDEX IF NOT EXISTS idx_responsible_aliases_responsible
  ON public.responsible_aliases(responsible_id);

COMMENT ON TABLE public.responsible_aliases IS
  'Nombres alternativos de un cliente/proveedor. Permite que el mismo responsible matchee múltiples nombres en facturas Siigo, extractos bancarios, etc. Auto-poblado desde Siigo + manual.';

-- RLS: igual que responsibles (owner-only)
ALTER TABLE public.responsible_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='responsible_aliases' AND policyname='users_manage_own_aliases') THEN
    CREATE POLICY "users_manage_own_aliases"
      ON public.responsible_aliases FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 3) Backfill: el responsible.name original es el primer alias por defecto
INSERT INTO public.responsible_aliases (user_id, responsible_id, alias, source)
SELECT user_id, id, name, 'manual'
FROM public.responsibles
WHERE active = true
ON CONFLICT (user_id, lower(trim(alias))) DO NOTHING;

-- 4) Backfill mejorado de invoices.responsible_id usando ALIASES
--    (esto cubre casos donde el nombre Siigo no matchea al canónico)
UPDATE public.invoices i
SET responsible_id = ra.responsible_id
FROM public.responsible_aliases ra
WHERE i.user_id = ra.user_id
  AND i.responsible_id IS NULL
  AND i.counterparty_name IS NOT NULL
  AND lower(trim(i.counterparty_name)) = lower(trim(ra.alias));

-- 5) Diagnóstico
DO $$
DECLARE
  v_invoices_with_responsible int;
  v_invoices_null int;
  v_aliases_count int;
BEGIN
  SELECT COUNT(*) INTO v_invoices_with_responsible
    FROM public.invoices WHERE responsible_id IS NOT NULL;
  SELECT COUNT(*) INTO v_invoices_null
    FROM public.invoices WHERE responsible_id IS NULL;
  SELECT COUNT(*) INTO v_aliases_count
    FROM public.responsible_aliases;

  RAISE NOTICE 'Acoplamiento Siigo: invoices con responsible_id = %', v_invoices_with_responsible;
  RAISE NOTICE 'Acoplamiento Siigo: invoices SIN responsible_id (NULL) = %', v_invoices_null;
  RAISE NOTICE 'Acoplamiento Siigo: aliases creados (1 por responsible activo) = %', v_aliases_count;
END $$;
