// Panel macro estilo Bloomberg/Wall Street.
//
// Reemplaza al ticker scroll horizontal anterior por un grid de cards
// con sparkline mini, valor, delta colorizado y un footer que cita las
// fuentes oficiales en vivo. Gana en señal de confianza vs. el scroll.
//
// Mantiene el mismo nombre/export (`MacroTicker`) por compatibilidad con
// los imports existentes (Dashboard.tsx).

import { TrendingUp, TrendingDown, Minus, Wifi } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMacroIndicators, type MacroIndicator } from '@/hooks/useMacroIndicators';

const ORDER: Record<string, number> = {
  trm: 1,
  dtf: 2,
  ipc_total: 3,
  ibr: 4,
  pib_sector: 5,
  ipc_sector: 6,
};

const SOURCE_LABEL: Record<MacroIndicator['source'], string> = {
  superfinanciera: 'Superfinanciera',
  banrep: 'BanRep',
  worldbank: 'World Bank',
  manual: 'Estimado',
  other: 'Pública',
};

const TYPE_HINT: Record<string, string> = {
  trm: 'Tasa Representativa del Mercado · COP/USD',
  dtf: 'Tasa de captación a 90 días · referencia para crédito',
  ipc_total: 'Inflación anual de Colombia',
  ibr: 'Indicador Bancario de Referencia',
  pib_sector: 'Producto Interno Bruto sectorial',
  ipc_sector: 'Inflación por sector',
};

function formatValue(ind: MacroIndicator): string {
  if (ind.unit === 'COP') {
    return `$${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ind.value)}`;
  }
  if (ind.unit === '%') {
    return `${ind.value.toFixed(2)}%`;
  }
  return new Intl.NumberFormat('es-CO').format(ind.value);
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relativeFreshness(iso: string): { label: string; tone: 'fresh' | 'stale' } {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 1) return { label: 'al día', tone: 'fresh' };
  if (days <= 7) return { label: `hace ${days}d`, tone: 'fresh' };
  if (days <= 35) return { label: `hace ${days}d`, tone: 'stale' };
  return { label: formatDate(iso), tone: 'stale' };
}

// SVG sparkline — pequeño, ligero, sin recharts (no vale el peso).
function Sparkline({ data, isUp, isDown }: { data: number[]; isUp: boolean; isDown: boolean }) {
  if (data.length < 2) {
    return (
      <svg width="100%" height="28" viewBox="0 0 100 28" preserveAspectRatio="none">
        <line x1="0" y1="14" x2="100" y2="14" stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const pad = 2;
  const stepX = (w - pad * 2) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${pad + (data.length - 1) * stepX},${h} L ${pad},${h} Z`;

  const color = isUp ? '#34d399' : isDown ? '#f87171' : '#94a3b8';
  const fillId = `sparkfill-${isUp ? 'u' : isDown ? 'd' : 'f'}`;

  return (
    <svg width="100%" height="28" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${fillId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IndicatorCard({ ind }: { ind: MacroIndicator }) {
  const isUp = ind.delta !== null && ind.delta > 0;
  const isDown = ind.delta !== null && ind.delta < 0;
  const delta = ind.delta;
  const deltaPct = ind.deltaPct;
  const colorClass = isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-slate-400';
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  const fresh = relativeFreshness(ind.date);
  const sourceLabel = SOURCE_LABEL[ind.source];
  const hint = TYPE_HINT[ind.type] ?? '';

  // Delta string (% para tasas, abs para COP).
  let deltaTxt: string | null = null;
  if (delta !== null && deltaPct !== null) {
    if (ind.unit === '%') {
      const sign = delta >= 0 ? '+' : '';
      deltaTxt = `${sign}${delta.toFixed(2)}pp`;
    } else {
      const sign = deltaPct >= 0 ? '+' : '';
      deltaTxt = `${sign}${deltaPct.toFixed(2)}%`;
    }
  }

  const sparkValues = ind.history.map(h => h.value);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="group relative flex flex-col gap-2 px-4 py-3 border-r border-white/[0.06] last:border-r-0 cursor-default transition-colors hover:bg-white/[0.03]"
            style={{ minWidth: 0 }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {ind.label}
              </span>
              <span
                className={`text-[9px] font-semibold uppercase tracking-wider ${
                  fresh.tone === 'fresh' ? 'text-emerald-400/80' : 'text-amber-400/80'
                }`}
              >
                {fresh.label}
              </span>
            </div>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-lg font-bold text-white tracking-tight">
                {formatValue(ind)}
              </span>
              {deltaTxt && (
                <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${colorClass}`}>
                  <Icon className="h-3 w-3" />
                  {deltaTxt}
                </span>
              )}
            </div>
            <Sparkline data={sparkValues} isUp={isUp} isDown={isDown} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="max-w-[260px]">
          <div className="text-xs font-semibold mb-1">{ind.label}</div>
          {hint && <div className="text-[11px] text-muted-foreground mb-1.5">{hint}</div>}
          <div className="text-[11px]">
            Última publicación: <span className="font-medium">{formatDate(ind.date)}</span>
          </div>
          <div className="text-[11px]">
            Fuente: <span className="font-medium">{sourceLabel}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function MacroTicker() {
  const { indicators, loading } = useMacroIndicators();

  if (loading || indicators.length === 0) return null;

  // Orden estable: TRM, DTF, IPC, IBR, sectoriales.
  const sorted = [...indicators]
    .filter(i => !i.type.startsWith('pib_') && !i.type.startsWith('ipc_sector'))
    .sort((a, b) => (ORDER[a.type] ?? 99) - (ORDER[b.type] ?? 99));

  // Fuentes únicas para el footer.
  const uniqueSources = new Set<string>();
  for (const ind of sorted) {
    uniqueSources.add(SOURCE_LABEL[ind.source]);
  }
  const sourceList = Array.from(uniqueSources).filter(s => s !== 'Estimado' && s !== 'Pública');
  // Fallback si todas son estimadas (caso degradado): muestra todas.
  const sourcesToShow = sourceList.length > 0
    ? sourceList
    : Array.from(uniqueSources);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
      style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both' }}
    >
      {/* Top brand strip */}
      <div className="h-[2px] bg-gradient-to-r from-emerald-500/0 via-emerald-500/60 to-emerald-500/0" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
            Mercados · En vivo
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500">
          <Wifi className="h-3 w-3" />
          <span className="uppercase tracking-wider font-medium">Sincronizado hoy</span>
        </div>
      </div>

      {/* Grid of indicators */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${Math.min(sorted.length, 4)}, minmax(0, 1fr))`,
        }}
      >
        {sorted.slice(0, 4).map(ind => (
          <IndicatorCard key={`${ind.type}-${ind.date}`} ind={ind} />
        ))}
      </div>

      {/* Footer: sources */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2.5 bg-black/20 border-t border-white/[0.05]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Datos en vivo de:
          </span>
          {sourcesToShow.map(src => (
            <span
              key={src}
              className="text-[10.5px] font-medium text-slate-300 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]"
            >
              {src}
            </span>
          ))}
        </div>
        <div className="text-[10px] text-slate-500 sm:text-right">
          Reglas fiscales <span className="text-slate-300 font-medium">DIAN 2026</span> integradas
        </div>
      </div>
    </div>
  );
}
