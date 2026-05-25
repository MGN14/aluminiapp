// Hook: cashflow forecast desde el RPC forecast_cashflow.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CashflowDay {
  fecha: string;
  expected_inflows: number;
  expected_outflows: number;
  net: number;
  cumulative_balance: number;
  inflow_sources: {
    expected_payments: number;
    invoices_venta_weighted: number;
    invoices_venta_raw: number;
    detail_expected: any[];
    detail_invoices: any[];
  };
  outflow_sources: {
    invoices_compra: number;
    credit_payments: number;
    recurring_estimated: number;
    detail_compras: any[];
    detail_credits: any[];
  };
  confidence: number;
}

export interface CashflowMonth {
  month_start: string;
  month_label: string;
  total_inflows: number;
  total_outflows: number;
  net: number;
  closing_balance: number;
  avg_confidence: number;
}

export function useCashflowForecastDaily(horizonDays = 60) {
  const { user } = useAuth();
  return useQuery<CashflowDay[]>({
    queryKey: ['cashflow-forecast-daily', user?.id, horizonDays],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase as any).rpc('forecast_cashflow', {
        p_user_id: user.id,
        p_horizon_days: horizonDays,
      });
      if (error) {
        console.warn('forecast_cashflow failed:', error.message);
        return [];
      }
      return (data ?? []).map((d: any) => ({
        ...d,
        expected_inflows: Number(d.expected_inflows) || 0,
        expected_outflows: Number(d.expected_outflows) || 0,
        net: Number(d.net) || 0,
        cumulative_balance: Number(d.cumulative_balance) || 0,
        confidence: Number(d.confidence) || 0,
      })) as CashflowDay[];
    },
  });
}

export function useCashflowForecastMonthly(monthsAhead = 6) {
  const { user } = useAuth();
  return useQuery<CashflowMonth[]>({
    queryKey: ['cashflow-forecast-monthly', user?.id, monthsAhead],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase as any).rpc('forecast_cashflow_monthly', {
        p_user_id: user.id,
        p_months_ahead: monthsAhead,
      });
      if (error) {
        console.warn('forecast_cashflow_monthly failed:', error.message);
        return [];
      }
      return (data ?? []).map((m: any) => ({
        ...m,
        total_inflows: Number(m.total_inflows) || 0,
        total_outflows: Number(m.total_outflows) || 0,
        net: Number(m.net) || 0,
        closing_balance: Number(m.closing_balance) || 0,
        avg_confidence: Number(m.avg_confidence) || 0,
      })) as CashflowMonth[];
    },
  });
}
