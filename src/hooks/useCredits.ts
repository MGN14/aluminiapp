import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { summarizeCredit, type AmortizationType, type AmortizationSummary } from '@/lib/amortization';

export interface Credit {
  id: string;
  name: string;
  bank_name: string | null;
  principal: number;
  interest_rate_monthly: number;
  term_months: number;
  start_date: string;
  first_payment_date: string;
  amortization_type: AmortizationType;
  status: 'active' | 'paid' | 'cancelled';
  notes: string | null;
  additional_costs_pct: number;
  additional_costs_label: string | null;
  default_category_id: string | null;
  default_responsible_id: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
}

export interface CreditPayment {
  id: string;
  credit_id: string;
  payment_date: string;
  amount_paid: number;
  principal_paid: number;
  interest_paid: number;
  is_extra: boolean;
  notes: string | null;
  transaction_id: string | null;
}

export interface CreditWithSummary {
  credit: Credit;
  payments: CreditPayment[];
  summary: AmortizationSummary;
}

export function useCredits() {
  const { user } = useAuth();
  return useQuery<CreditWithSummary[]>({
    queryKey: ['credits', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [creditsRes, paymentsRes] = await Promise.all([
        supabase
          .from('credits' as never)
          .select('*')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('credit_payments' as never)
          .select('*')
          .eq('user_id', user!.id),
      ]);

      const credits = ((creditsRes.data ?? []) as unknown as Credit[]);
      const payments = ((paymentsRes.data ?? []) as unknown as CreditPayment[]);

      return credits.map((c) => {
        const p = payments.filter((pay) => pay.credit_id === c.id);
        const summary = summarizeCredit(
          {
            principal: Number(c.principal),
            interestRateMonthlyPct: Number(c.interest_rate_monthly),
            termMonths: c.term_months,
            firstPaymentDate: c.first_payment_date,
            type: c.amortization_type,
          },
          p,
          Number(c.additional_costs_pct ?? 0),
        );
        return { credit: c, payments: p, summary };
      });
    },
  });
}
