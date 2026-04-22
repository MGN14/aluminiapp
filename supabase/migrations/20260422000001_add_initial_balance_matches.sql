-- Partial payments against initial_state_details entries (saldos iniciales CxC).
-- Mirror of invoice_transaction_matches but for historical balances that
-- don't have a corresponding invoice.

CREATE TABLE IF NOT EXISTS public.initial_balance_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_state_detail_id uuid NOT NULL
    REFERENCES public.initial_state_details(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL
    REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  matched_amount numeric NOT NULL CHECK (matched_amount > 0),
  match_type text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS initial_balance_matches_unique
  ON public.initial_balance_matches(initial_state_detail_id, transaction_id);

CREATE INDEX IF NOT EXISTS initial_balance_matches_user_idx
  ON public.initial_balance_matches(user_id);

CREATE INDEX IF NOT EXISTS initial_balance_matches_tx_idx
  ON public.initial_balance_matches(transaction_id);

ALTER TABLE public.initial_balance_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ibm_select_own"
  ON public.initial_balance_matches FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "ibm_insert_own"
  ON public.initial_balance_matches FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ibm_update_own"
  ON public.initial_balance_matches FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ibm_delete_own"
  ON public.initial_balance_matches FOR DELETE
  USING (user_id = auth.uid());
