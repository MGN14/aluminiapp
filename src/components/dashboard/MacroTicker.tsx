import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useMacroIndicators, type MacroIndicator } from '@/hooks/useMacroIndicators';

function formatValue(ind: MacroIndicator): string {
  if (ind.unit === 'COP') {
    return `$${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ind.value)}`;
  }
  if (ind.unit === '%') {
    return `${ind.value.toFixed(2)}%`;
  }
  return new Intl.NumberFormat('es-CO').format(ind.value);
}

function formatDelta(ind: MacroIndicator): string | null {
  if (ind.delta === null || ind.deltaPct === null) return null;
  const sign = ind.delta >= 0 ? '+' : '';
  return `${sign}${ind.deltaPct.toFixed(2)}%`;
}

function TickerItem({ ind }: { ind: MacroIndicator }) {
  const isUp = ind.delta !== null && ind.delta > 0;
  const isDown = ind.delta !== null && ind.delta < 0;
  const colorClass = isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-muted-foreground';
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  const delta = formatDelta(ind);

  return (
    <span className="inline-flex items-center gap-2 px-6 whitespace-nowrap text-sm font-mono tabular-nums">
      <span className="text-muted-foreground uppercase tracking-wider text-xs">{ind.label}</span>
      <span className="font-semibold text-foreground">{formatValue(ind)}</span>
      {delta && (
        <span className={`inline-flex items-center gap-0.5 ${colorClass}`}>
          <Icon className="h-3 w-3" />
          {delta}
        </span>
      )}
      <span className="text-muted-foreground/60 text-xs">|</span>
    </span>
  );
}

export default function MacroTicker() {
  const { indicators, loading } = useMacroIndicators();

  if (loading || indicators.length === 0) return null;

  // Duplicate the list so the marquee loops seamlessly.
  const loop = [...indicators, ...indicators];

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-r from-slate-950/60 via-slate-900/40 to-slate-950/60 backdrop-blur-sm py-2.5">
      <div className="flex items-center">
        <div className="shrink-0 px-4 text-[10px] font-bold uppercase tracking-widest text-emerald-400 border-r border-white/[0.06] mr-2">
          ● Live
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex animate-[ticker_40s_linear_infinite] hover:[animation-play-state:paused]">
            {loop.map((ind, i) => (
              <TickerItem key={`${ind.type}-${i}`} ind={ind} />
            ))}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
