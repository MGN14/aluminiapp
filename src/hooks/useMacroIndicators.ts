import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MacroIndicator {
  type: string;          // 'trm' | 'ipc_total' | 'dtf' | 'aluminio_lme' | ...
  label: string;         // 'Dólar', 'Inflación', etc. (colombiano-friendly)
  sublabel: string;      // 'TRM oficial', 'DTF · BanRep' (sigla técnica)
  value: number;
  unit: string;          // 'COP' | '%' | 'USD/ton' | ...
  date: string;          // YYYY-MM-DD
  delta: number | null;  // value - previous value, null if no prior
  deltaPct: number | null;
  history: Array<{ date: string; value: number }>; // ascending; most recent last
  source: 'banrep' | 'superfinanciera' | 'worldbank' | 'tradingeconomics' | 'yahoo_finance' | 'manual' | 'other';
  // Tendencia 30d: cambio % vs ~30 días atrás (signal alcista/bajista de mediano plazo).
  // null si no hay suficiente historia (<10 puntos antiguos).
  trend30dPct: number | null;
}

interface RawRow {
  indicator_type: string;
  sector_code: string | null;
  period_date: string;
  value: number;
  unit: string | null;
  source?: string | null;
}

// Nombres "colombianos" para que un dueño de PYME entienda sin diccionario.
// La sigla técnica (TRM/DTF/IPC/LME) la mostramos como sublabel chico —
// igual que Bloomberg muestra "USD/COP" en grande pero sabe que es el dólar.
const LABELS: Record<string, string> = {
  trm: 'Dólar',
  dtf: 'Costo del crédito',
  ipc_total: 'Inflación',
  ibr: 'Tasa interbancaria',
  aluminio_lme: 'Aluminio',
  pib_sector: 'PIB sector',
  ipc_sector: 'Inflación sector',
};

// Sigla técnica al lado del label principal — para credibilidad financiera.
const SUBLABELS: Record<string, string> = {
  trm: 'TRM oficial',
  dtf: 'DTF · BanRep',
  ipc_total: 'IPC anual',
  ibr: 'IBR · BanRep',
  aluminio_lme: 'LME · USD/ton',
  pib_sector: 'DANE',
  ipc_sector: 'DANE',
};

const SOURCE_FOR_TYPE: Record<string, MacroIndicator['source']> = {
  trm: 'superfinanciera',
  dtf: 'banrep',
  ibr: 'banrep',
  ipc_total: 'worldbank', // override below if metadata.source dice otra
  aluminio_lme: 'yahoo_finance', // override en runtime según metadata
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
        // Tendencia 30d: comparamos último valor vs el más antiguo de la ventana
        // de 30 puntos. Pide mínimo 10 puntos para no dar falsa señal.
        let trend30dPct: number | null = null;
        if (history.length >= 10) {
          const oldest = history[0].value;
          const newest = history[history.length - 1].value;
          if (oldest > 0) {
            trend30dPct = ((newest - oldest) / oldest) * 100;
          }
        }
        const sourceRaw = (latest.source ?? '').toLowerCase();
        const source: MacroIndicator['source'] = sourceRaw.includes('banrep')
          ? 'banrep'
          : sourceRaw.includes('superfin') || sourceRaw.includes('datos.gov')
            ? 'superfinanciera'
            : sourceRaw.includes('worldbank')
              ? 'worldbank'
              : sourceRaw.includes('tradingeconomics') || sourceRaw.includes('trading_economics')
                ? 'tradingeconomics'
                : sourceRaw.includes('yahoo')
                  ? 'yahoo_finance'
                  : sourceRaw === 'manual'
                    ? 'manual'
                    : SOURCE_FOR_TYPE[latest.indicator_type] ?? 'other';
        result.push({
          type: latest.indicator_type,
          label: LABELS[latest.indicator_type] ?? latest.indicator_type.toUpperCase(),
          sublabel: SUBLABELS[latest.indicator_type] ?? '',
          value: Number(latest.value),
          unit: latest.unit ?? '',
          date: latest.period_date,
          delta,
          deltaPct,
          history,
          source,
          trend30dPct,
        });
      }
      setIndicators(result);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  return { indicators, loading };
}
