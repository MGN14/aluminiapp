import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MacroIndicator {
  type: string;          // 'trm' | 'ipc_total' | 'dtf' | 'ibr' | ...
  label: string;         // 'TRM', 'IPC anual', etc.
  value: number;
  unit: string;          // 'COP' | '%' | 'index'
  date: string;          // YYYY-MM-DD
  delta: number | null;  // value - previous value, null if no prior
  deltaPct: number | null;
}

interface RawRow {
  indicator_type: string;
  sector_code: string | null;
  period_date: string;
  value: number;
  unit: string | null;
}

const LABELS: Record<string, string> = {
  trm: 'TRM',
  ipc_total: 'IPC anual',
  dtf: 'DTF',
  ibr: 'IBR',
  pib_sector: 'PIB sector',
  ipc_sector: 'IPC sector',
};

export function useMacroIndicators() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('macro_indicators' as never)
        .select('indicator_type, sector_code, period_date, value, unit')
        .order('period_date', { ascending: false })
        .limit(200);

      if (!active) return;

      const rows = (data ?? []) as unknown as RawRow[];
      // Group by (type, sector) and keep the two most recent rows per group.
      const buckets = new Map<string, RawRow[]>();
      for (const r of rows) {
        const key = `${r.indicator_type}|${r.sector_code ?? ''}`;
        const arr = buckets.get(key) ?? [];
        if (arr.length < 2) arr.push(r);
        buckets.set(key, arr);
      }

      const result: MacroIndicator[] = [];
      for (const [, arr] of buckets) {
        const [latest, prev] = arr;
        if (!latest) continue;
        const delta = prev ? latest.value - prev.value : null;
        const deltaPct = prev && prev.value > 0 ? (delta! / prev.value) * 100 : null;
        result.push({
          type: latest.indicator_type,
          label: LABELS[latest.indicator_type] ?? latest.indicator_type.toUpperCase(),
          value: Number(latest.value),
          unit: latest.unit ?? '',
          date: latest.period_date,
          delta,
          deltaPct,
        });
      }
      setIndicators(result);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  return { indicators, loading };
}
