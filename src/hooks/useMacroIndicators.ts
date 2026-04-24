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
  history: Array<{ date: string; value: number }>; // ascending; most recent last
  source: 'banrep' | 'superfinanciera' | 'worldbank' | 'manual' | 'other';
}

interface RawRow {
  indicator_type: string;
  sector_code: string | null;
  period_date: string;
  value: number;
  unit: string | null;
  source?: string | null;
}

const LABELS: Record<string, string> = {
  trm: 'TRM',
  ipc_total: 'IPC anual',
  dtf: 'DTF',
  ibr: 'IBR',
  pib_sector: 'PIB sector',
  ipc_sector: 'IPC sector',
};

const SOURCE_FOR_TYPE: Record<string, MacroIndicator['source']> = {
  trm: 'superfinanciera',
  dtf: 'banrep',
  ibr: 'banrep',
  ipc_total: 'worldbank', // override below if metadata.source dice otra
};

export function useMacroIndicators() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      // Más historia para que las sparklines tengan suficientes puntos.
      const { data } = await supabase
        .from('macro_indicators' as never)
        .select('indicator_type, sector_code, period_date, value, unit, source')
        .order('period_date', { ascending: false })
        .limit(800);

      if (!active) return;

      const rows = (data ?? []) as unknown as RawRow[];
      // Bucket por (type, sector) — todas las filas, ordenadas desc por fecha.
      const buckets = new Map<string, RawRow[]>();
      for (const r of rows) {
        const key = `${r.indicator_type}|${r.sector_code ?? ''}`;
        const arr = buckets.get(key) ?? [];
        arr.push(r);
        buckets.set(key, arr);
      }

      const result: MacroIndicator[] = [];
      for (const [, arr] of buckets) {
        const [latest, prev] = arr;
        if (!latest) continue;
        const delta = prev ? latest.value - prev.value : null;
        const deltaPct = prev && prev.value > 0 ? (delta! / prev.value) * 100 : null;
        // Sparkline: hasta 30 puntos más recientes, en orden ASC.
        const history = arr
          .slice(0, 30)
          .map(r => ({ date: r.period_date, value: Number(r.value) }))
          .reverse();
        const sourceRaw = (latest.source ?? '').toLowerCase();
        const source: MacroIndicator['source'] = sourceRaw.includes('banrep')
          ? 'banrep'
          : sourceRaw.includes('superfin') || sourceRaw.includes('datos.gov')
            ? 'superfinanciera'
            : sourceRaw.includes('worldbank')
              ? 'worldbank'
              : sourceRaw === 'manual'
                ? 'manual'
                : SOURCE_FOR_TYPE[latest.indicator_type] ?? 'other';
        result.push({
          type: latest.indicator_type,
          label: LABELS[latest.indicator_type] ?? latest.indicator_type.toUpperCase(),
          value: Number(latest.value),
          unit: latest.unit ?? '',
          date: latest.period_date,
          delta,
          deltaPct,
          history,
          source,
        });
      }
      setIndicators(result);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  return { indicators, loading };
}
