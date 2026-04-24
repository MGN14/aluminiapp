// Modal con histórico ampliado de un indicador macro.
// Se abre al click en una card del MacroTicker.
//
// Diseño: dark mode (matching el panel), AreaChart de recharts con
// hover tooltip, toggle de período (todo / 30d / 7d), explicación
// pragmática del indicador y cita de fuente al pie.

import { useMemo, useState } from 'react';
import { X, Info, Radio } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { MacroIndicator } from '@/hooks/useMacroIndicators';

const SOURCE_LABEL: Record<MacroIndicator['source'], string> = {
  superfinanciera: 'Superintendencia Financiera de Colombia',
  banrep: 'Banco de la República',
  worldbank: 'World Bank Indicators API',
  tradingeconomics: 'Trading Economics',
  yahoo_finance: 'Yahoo Finance (LME futures)',
  manual: 'Última publicación oficial conocida',
  other: 'Fuente pública',
};

// Texto pragmático que explica para qué sirve el indicador, sin jerga.
const EXPLANATION: Record<string, { what: string; why: string }> = {
  trm: {
    what: 'Es el precio oficial del dólar en pesos colombianos. Lo publica la Superintendencia Financiera todos los días.',
    why: 'Si vendés/comprás afuera o tenés deuda en dólares, este número define cuánto te entra o cuánto pagás en pesos hoy.',
  },
  dtf: {
    what: 'Es la tasa base de los créditos en Colombia. Cuando un banco te ofrece "DTF + 5", te cobra esta tasa más esos 5 puntos.',
    why: 'Si está alta, los créditos son caros. Si baja, es buen momento para tomar préstamos o renegociar tasas variables.',
  },
  ipc_total: {
    what: 'Es el aumento promedio de precios en Colombia en los últimos 12 meses (inflación anual oficial).',
    why: 'Te dice cuánto perdió de poder adquisitivo el peso. Si tu negocio creció 4% pero la inflación es 6%, en realidad encogiste 2% real.',
  },
  ibr: {
    what: 'Es la tasa que se cobran los bancos entre sí. Reemplaza a la DTF en muchos créditos modernos.',
    why: 'Igual que la DTF, pero más usada en créditos corporativos grandes y en derivados.',
  },
  aluminio_lme: {
    what: 'Es el precio del aluminio en la Bolsa de Metales de Londres (LME), el referente mundial de commodities metálicos.',
    why: 'Si tu negocio compra o vende aluminio (latas, perfilería, autopartes), este precio te dice si la materia prima está cara o barata hoy.',
  },
};

interface Props {
  indicator: MacroIndicator | null;
  onClose: () => void;
}

type RangeKey = 'all' | '30d' | '7d';

function formatValueFor(ind: MacroIndicator, v: number): string {
  if (ind.unit === '%') return `${v.toFixed(2)}%`;
  if (ind.unit === 'COP') {
    return `$${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
  }
  if (ind.unit === 'USD/ton') {
    return `US$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v)} /ton`;
  }
  return new Intl.NumberFormat('es-CO').format(v);
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

export default function MacroDetailModal({ indicator, onClose }: Props) {
  const [range, setRange] = useState<RangeKey>('all');

  const chartData = useMemo(() => {
    if (!indicator) return [];
    let history = indicator.history;
    if (range === '30d') history = history.slice(-30);
    if (range === '7d') history = history.slice(-7);
    return history.map(h => ({
      date: h.date,
      label: formatDateShort(h.date),
      value: h.value,
    }));
  }, [indicator, range]);

  if (!indicator) return null;

  const explanation = EXPLANATION[indicator.type] ?? {
    what: 'Indicador macroeconómico oficial.',
    why: 'Útil para contextualizar tus decisiones financieras.',
  };
  const sourceLabel = SOURCE_LABEL[indicator.source];
  const isUp = indicator.delta !== null && indicator.delta > 0;
  const isDown = indicator.delta !== null && indicator.delta < 0;
  const trendColor = isUp ? '#34d399' : isDown ? '#f87171' : '#94a3b8';
  const hasEnoughHistory = chartData.length >= 2;

  // Delta string (% para tasas, abs para COP).
  let deltaTxt: string | null = null;
  if (indicator.delta !== null && indicator.deltaPct !== null) {
    const d = indicator.delta;
    const dp = indicator.deltaPct;
    if (indicator.unit === '%') {
      deltaTxt = `${d >= 0 ? '+' : ''}${d.toFixed(2)}pp`;
    } else {
      deltaTxt = `${dp >= 0 ? '+' : ''}${dp.toFixed(2)}%`;
    }
  }

  return (
    <Dialog open={!!indicator} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl border-0 p-0 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
        style={{ color: '#fff' }}
      >
        {/* Top brand strip */}
        <div className="h-[2px] bg-gradient-to-r from-emerald-500/0 via-emerald-500/60 to-emerald-500/0" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-white/[0.05]">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
                {indicator.sublabel || 'En vivo'}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">{indicator.label}</h2>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-3xl font-bold text-white">{formatValueFor(indicator, indicator.value)}</span>
              {deltaTxt && (
                <span className="text-sm font-semibold" style={{ color: trendColor }}>
                  {deltaTxt}
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500">
              Última publicación: {formatDateLong(indicator.date)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Range selector */}
        {hasEnoughHistory && (
          <div className="flex items-center gap-1 px-6 pt-4">
            {(['7d', '30d', 'all'] as RangeKey[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-[11px] font-semibold uppercase tracking-wider rounded-md transition-colors ${
                  range === r
                    ? 'bg-white/[0.08] text-white'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {r === 'all' ? 'Todo' : r === '30d' ? '30 días' : '7 días'}
              </button>
            ))}
          </div>
        )}

        {/* Chart */}
        <div className="px-6 pt-3 pb-4">
          {hasEnoughHistory ? (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="macroDetailGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={trendColor} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={trendColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => {
                      if (indicator.unit === '%') return `${v.toFixed(1)}%`;
                      if (indicator.unit === 'COP' && v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
                      if (indicator.unit === 'USD/ton') return `$${v.toFixed(0)}`;
                      return String(v);
                    }}
                    width={60}
                    domain={['dataMin', 'dataMax']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#fff',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                    }}
                    labelStyle={{ color: '#94a3b8', fontSize: 10, marginBottom: 4 }}
                    formatter={(value: number) => [formatValueFor(indicator, value), indicator.label]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={trendColor}
                    strokeWidth={2.5}
                    fill="url(#macroDetailGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[220px] text-center px-6">
              <Info className="w-8 h-8 text-slate-500 mb-2" />
              <p className="text-sm text-slate-400">
                Aún no hay suficiente historial para graficar.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                A medida que sincronicemos más días, vas a ver la evolución acá.
              </p>
            </div>
          )}
        </div>

        {/* Explanation */}
        <div className="px-6 pb-3">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-start gap-2.5 mb-2.5">
              <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-300 leading-relaxed">
                <span className="font-semibold text-white">¿Qué es?</span>{' '}
                {explanation.what}
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <Radio className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-300 leading-relaxed">
                <span className="font-semibold text-white">¿Por qué importa?</span>{' '}
                {explanation.why}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-black/30 border-t border-white/[0.05] flex items-center justify-between flex-wrap gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Fuente
            </span>
            <span className="text-[11.5px] text-slate-200 font-medium">{sourceLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:text-right">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Sincronizado
            </span>
            <span className="text-[11.5px] text-slate-200 font-medium">{formatDateLong(indicator.date)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
