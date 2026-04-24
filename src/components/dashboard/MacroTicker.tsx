// Panel macro estilo Bloomberg/Wall Street.
//
// Reemplaza al ticker scroll horizontal anterior por un grid de cards
// con sparkline mini, valor, delta colorizado y un footer que cita las
// fuentes oficiales en vivo. Gana en señal de confianza vs. el scroll.
//
// Mantiene el mismo nombre/export (`MacroTicker`) por compatibilidad con
// los imports existentes (Dashboard.tsx).

import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Wifi } from 'lucide-react';
import { useMacroIndicators, type MacroIndicator } from '@/hooks/useMacroIndicators';
import MacroDetailModal from './MacroDetailModal';

const ORDER: Record<string, number> = {
  trm: 1,
  dtf: 2,
  ipc_total: 3,
  aluminio_lme: 4,
  ibr: 5,
  pib_sector: 6,
  ipc_sector: 7,
};

const SOURCE_LABEL: Record<MacroIndicator['source'], string> = {
  superfinanciera: 'Superfinanciera',
  banrep: 'BanRep',
  worldbank: 'World Bank',
  tradingeconomics: 'Trading Economics',
  yahoo_finance: 'LME · Yahoo',
  manual: 'Estimado',
  other: 'Pública',
};

function formatValue(ind: MacroIndicator): string {
  if (ind.unit === 'COP') {
    return `$${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ind.value)}`;
  }
  if (ind.unit === '%') {
    return `${ind.value.toFixed(2)}%`;
  }
  if (ind.unit === 'USD/ton') {
    // En la card no entra "/ton"; lo mostramos en el modal de detalle.
    return `US$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(ind.value))}`;
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

function IndicatorCard({ ind, onClick }: { ind: MacroIndicator; onClick: () => void }) {
  const isUp = ind.delta !== null && ind.delta > 0;
  const isDown = ind.delta !== null && ind.delta < 0;
  const delta = ind.delta;
  const deltaPct = ind.deltaPct;
  const colorClass = isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-slate-400';
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  const fresh = relativeFreshness(ind.date);

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
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver histórico de ${ind.label}`}
      className="group relative flex flex-col gap-1.5 px-4 py-3 border-r border-white/[0.06] last:border-r-0 cursor-pointer transition-colors hover:bg-white/[0.04] focus:outline-none focus:bg-white/[0.04] text-left"
      style={{ minWidth: 0, background: 'transparent' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[12.5px] font-semibold text-white tracking-tight truncate">
            {ind.label}
          </span>
          {ind.sublabel && (
            <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-slate-500 truncate">
              {ind.sublabel}
            </span>
          )}
        </div>
        <span
          className={`text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap ${
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
      {ind.trend30dPct !== null && Math.abs(ind.trend30dPct) >= 0.1 && (
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-slate-500">30d</span>
          <span
            className={`font-semibold tabular-nums ${
              ind.trend30dPct > 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {ind.trend30dPct > 0 ? '↗' : '↘'} {ind.trend30dPct > 0 ? '+' : ''}{ind.trend30dPct.toFixed(2)}%
          </span>
        </div>
      )}
      <span
        className="absolute top-2 right-2 text-[8.5px] uppercase tracking-wider text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-hidden="true"
      >
        Ver detalle →
      </span>
    </button>
  );
}

export default function MacroTicker() {
  const { indicators, loading } = useMacroIndicators();
  const [selected, setSelected] = useState<MacroIndicator | null>(null);

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
          <IndicatorCard
            key={`${ind.type}-${ind.date}`}
            ind={ind}
            onClick={() => setSelected(ind)}
          />
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

      <MacroDetailModal indicator={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
