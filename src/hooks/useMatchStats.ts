// Hook: stats de auto-matches recientes (últimos 30 días).
// Lee de transaction_match_log + agrupa por source para distinguir
// trigger automático vs aplicación manual.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface MatchStats {
  total_last_30d: number;
  by_source: {
    trigger: number;       // auto al INSERT (lo más común)
    manual: number;        // applyRulesToStatement desde subida CSV
    retro_cron: number;    // red de seguridad diaria
    frontend: number;      // botón "Aplicar a transacciones existentes"
  };
  last_match_at: string | null;
  top_rules: { rule_id: string; count: number }[];
}

export function useMatchStats() {
  const { user } = useAuth();

  return useQuery<MatchStats>({
    queryKey: ['match-stats', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return { total_last_30d: 0, by_source: { trigger: 0, manual: 0, retro_cron: 0, frontend: 0 }, last_match_at: null, top_rules: [] };
      }
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await (supabase as any)
        .from('transaction_match_log')
        .select('rule_id, source, matched_at')
        .gte('matched_at', since.toISOString())
        .order('matched_at', { ascending: false });
      if (error) {
        // Tabla aún no existe → devolver vacío en lugar de romper UI
        return { total_last_30d: 0, by_source: { trigger: 0, manual: 0, retro_cron: 0, frontend: 0 }, last_match_at: null, top_rules: [] };
      }
      const rows = (data ?? []) as { rule_id: string; source: string; matched_at: string }[];
      const bySource: MatchStats['by_source'] = { trigger: 0, manual: 0, retro_cron: 0, frontend: 0 };
      const ruleCounts = new Map<string, number>();
      for (const r of rows) {
        const src = (r.source as keyof typeof bySource) ?? 'trigger';
        if (src in bySource) bySource[src]++;
        ruleCounts.set(r.rule_id, (ruleCounts.get(r.rule_id) ?? 0) + 1);
      }
      const topRules = [...ruleCounts.entries()]
        .map(([rule_id, count]) => ({ rule_id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        total_last_30d: rows.length,
        by_source: bySource,
        last_match_at: rows[0]?.matched_at ?? null,
        top_rules: topRules,
      };
    },
  });
}
