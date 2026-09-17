import { useMemo } from 'react';
import { CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { TrendingDown } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFinancialHealthScore, getScoreInterpretation } from '@/hooks/useFinancialHealthScore';
import { SCORE_VARIABLES, ScoreVariableKey } from '@/hooks/financialHealthScoreUtils';
import { DashCard, DashFooter, DashLoading, type Tone } from './cardKit';
import { cn } from '@/lib/utils';

interface Props {
  year: number;
  month: number;
}

// Mensajes accionables por variable — mostrados cuando la variable es el punto más débil.
const ACTION_MESSAGES: Record<ScoreVariableKey, string> = {
  conciliacion: 'Asigná responsable o factura a los movimientos bancarios sin soporte.',
  facturacion: 'Emití facturas DIAN de los ingresos que todavía no están respaldados.',
  impuestos: 'Revisá descuadres entre inventario Siigo y el conteo físico.',
  cartera: 'Cobrá lo que te deben o asociá facturas a los anticipos pendientes.',
};

export default function FinancialHealthCard({ year, month }: Props) {
  const { scores, loading } = useFinancialHealthScore(year, month);

  const donutData = useMemo(() => {
    if (!scores) return [];
    return SCORE_VARIABLES.map((v) => ({
      key: v.key,
      name: v.shortLabel,
      label: v.label,
      value: scores[v.key],
      color: v.color,
      hint: v.hint,
    }));
  }, [scores]);

  // La variable con menor score — "tu punto más débil".
  const weakest = useMemo(() => {
    if (!scores || donutData.length === 0) return null;
    return donutData.reduce((min, cur) => (cur.value < min.value ? cur : min), donutData[0]);
  }, [scores, donutData]);

  const bgValue = scores ? Math.max(0, 100 - scores.total) : 100;

  if (loading) return <DashLoading lines={3} />;
  if (!scores) return null;

  const interp = getScoreInterpretation(scores.total);
  const tone: Tone = scores.total < 60 ? 'alarm' : scores.total < 80 ? 'warn' : 'success';

  return (
    <Link to="/financial-health" className="block group h-full">
      <DashCard tone={tone}>
        <CardContent className="p-4 sm:p-5 h-full flex flex-col">
          {/* Encabezado: donut grande + nivel */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative w-28 h-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[{ value: 100 }]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={52}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    <Cell fill="hsl(var(--muted))" />
                  </Pie>
                  <Pie
                    data={[...donutData, { name: 'empty', value: bgValue, color: 'transparent' }]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={52}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    paddingAngle={1.5}
                  >
                    {donutData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                    <Cell fill="transparent" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn('text-3xl font-extrabold tracking-tight tabular-nums leading-none', interp.color)}>{scores.total}</span>
                <span className="text-[10px] font-semibold text-muted-foreground mt-1">/100</span>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold tracking-tight text-foreground leading-tight">Ojo, viene la DIAN</p>
              <p className={cn('text-base font-bold mt-1 leading-tight', interp.color)}>{interp.level}</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{interp.message}</p>
            </div>
          </div>

          {/* Variable más baja destacada */}
          {weakest && (
            <div
              className="rounded-xl border border-border/60 bg-card/70 p-3 mb-3"
              style={{ borderLeftColor: weakest.color, borderLeftWidth: '4px' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <TrendingDown className="h-3.5 w-3.5" strokeWidth={2.5} /> Tu punto más débil
                </span>
                <span
                  className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-muted shrink-0"
                  style={{ color: weakest.color }}
                >
                  {weakest.value.toFixed(1)} / 25
                </span>
              </div>
              <p className="text-sm font-bold text-foreground">{weakest.label}</p>
              <p className="text-xs text-muted-foreground leading-snug mt-0.5">{ACTION_MESSAGES[weakest.key]}</p>
            </div>
          )}

          {/* Barras de las variables */}
          <div className="space-y-2 flex-1">
            {donutData.map((seg) => {
              const pct = Math.max(0, Math.min(100, (seg.value / 25) * 100));
              return (
                <div key={seg.key} className="flex items-center gap-2.5" title={seg.hint}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-xs font-medium text-foreground/80 flex-1 truncate">{seg.name}</span>
                  <div className="w-24 h-2 rounded-full bg-muted overflow-hidden shrink-0">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: seg.color }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums w-9 text-right text-foreground">{seg.value.toFixed(1)}</span>
                </div>
              );
            })}
          </div>

          <DashFooter note="4 variables · 25 puntos cada una">Ver análisis completo</DashFooter>
        </CardContent>
      </DashCard>
    </Link>
  );
}
