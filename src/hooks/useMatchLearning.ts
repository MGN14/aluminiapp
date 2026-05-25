// Hook: stats de aprendizaje pasivo del auto-matching.
// Lee de la view user_match_learning_stats.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface SignalStat {
  signal: string;
  value: string;
  confirmed: number;
  rejected: number;
  total: number;
  confirm_pct: number;
  user_decisions_total: number;
}

export interface MatchLearning {
  total_decisions: number;
  total_confirmed: number;
  total_rejected: number;
  active: boolean; // true si >=20 decisiones (umbral mínimo)
  by_signal: SignalStat[];
}

const SIGNAL_LABEL: Record<string, string> = {
  ref_in_desc_true: '📋 Número de factura en descripción',
  client_match_nit: '🆔 NIT del cliente en descripción',
  client_match_name: '👤 Nombre del cliente en descripción',
  amount_match_exact: '💰 Monto exacto',
  amount_match_exact_total: '💰 Monto = total factura',
  amount_match_near: '~ Monto cercano (±10%)',
  amount_match_near_total: '~ Total cercano (±10%)',
  expected_payment_match_true: '🤝 Coincide con promesa de pago',
};

export function getSignalLabel(signal: string, value: string): string {
  return SIGNAL_LABEL[`${signal}_${value}`] ?? `${signal} = ${value}`;
}

export function useMatchLearning() {
  const { user } = useAuth();

  return useQuery<MatchLearning>({
    queryKey: ['match-learning', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return { total_decisions: 0, total_confirmed: 0, total_rejected: 0, active: false, by_signal: [] };
      }

      // Totales
      const { data: totalsData } = await (supabase as any)
        .from('invoice_match_suggestions')
        .select('status')
        .eq('user_id', user.id)
        .in('status', ['confirmed', 'rejected']);

      const rows = ((totalsData ?? []) as { status: string }[]);
      const total_confirmed = rows.filter(r => r.status === 'confirmed').length;
      const total_rejected = rows.filter(r => r.status === 'rejected').length;
      const total_decisions = total_confirmed + total_rejected;

      // Stats por señal (de la view)
      const { data: signalData, error } = await (supabase as any)
        .from('user_match_learning_stats')
        .select('signal, value, confirmed, rejected, total, confirm_pct, user_decisions_total')
        .order('total', { ascending: false });

      const by_signal: SignalStat[] = error ? [] : ((signalData ?? []) as SignalStat[]);

      return {
        total_decisions,
        total_confirmed,
        total_rejected,
        active: total_decisions >= 20,
        by_signal,
      };
    },
  });
}
