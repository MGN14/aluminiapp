-- Cada credito guarda su categoria y beneficiario por defecto. Al conciliar
-- una transaccion bancaria con un credito, esos defaults se usan para crear
-- el credit_payment y dejar el credito al dia automaticamente.

ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS default_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_responsible_id uuid REFERENCES public.responsibles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.credits.default_category_id IS 'Categoria por defecto al conciliar un pago bancario con este credito (ej. Gastos Financieros).';
COMMENT ON COLUMN public.credits.default_responsible_id IS 'Beneficiario por defecto del credito (ej. Bancolombia, Davivienda).';

CREATE INDEX IF NOT EXISTS credits_default_responsible_idx
  ON public.credits(default_responsible_id) WHERE default_responsible_id IS NOT NULL;

-- Link entre credit_payment y la transaccion bancaria que lo origino. Cuando
-- el usuario concilia desde Relacion de Pagos, se crea el credit_payment y
-- se guarda aqui el FK; asi sabemos que esa tx ya esta conciliada con un
-- credito y no la mostramos como pendiente. ON DELETE SET NULL para no
-- perder el pago si se borra el extracto.

ALTER TABLE public.credit_payments
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.credit_payments.transaction_id IS 'FK a transactions cuando el pago se origino conciliando una transaccion bancaria. NULL si fue manual.';

CREATE INDEX IF NOT EXISTS credit_payments_transaction_idx
  ON public.credit_payments(transaction_id) WHERE transaction_id IS NOT NULL;
