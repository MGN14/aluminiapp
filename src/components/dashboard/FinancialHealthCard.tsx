import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingDown } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFinancialHealthScore, getScoreInterpretation } from '@/hooks/useFinancialHealthScore';
import { SCORE_VARIABLES, ScoreVariableKey } from '@/hooks/financialHealthScoreUtils';
import { Skeleton } from '@/components/ui/skeleton';

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

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="p-4">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!scores) return null;

  const interp = getScoreInterpretation(scores.total);

  return (
    <Link to="/financial-health" className="block group h-full">
      <Card className="overflow-hidden border border-border hover:border-primary/20 transition-colors cursor-pointer h-full">
        <CardContent className="p-4 h-full flex flex-col">
          {/* Header: Donut + score + level */}
          <div className="flex items-center gap-4 mb-3">
            <div className="relative w-24 h-24 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[{ value: 100 }]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={42}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    <Cell fill="hsl(var(--muted))" />
                  </Pie>
                  <Pie
                    data={[...donutData, { name: 'empty', value: bgValue, color: 'transparent' }]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={42}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    paddingAngle={1}
                  >
                    {donutData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                    <Cell fill="transparent" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-xl font-bold ${interp.color}`}>{scores.total}</span>
                <span className="text-[9px] text-muted-foreground">/100</span>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Ojo, viene la DIAN</p>
              <p className={`text-sm font-semibold ${interp.color}`}>{interp.level}</p>
            </div>
          </div>

          {/* Variable más baja destacada */}
          {weakest && (
            <div
              className="rounded-lg border border-border/60 bg-muted/40 p-2.5 mb-3"
              style={{ borderLeftColor: weakest.color, borderLeftWidth: '3px' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <TrendingDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    Tu punto más débil
                  </span>
                </div>
                <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: weakest.color }}>
                  {weakest.value.toFixed(1)}/25
                </span>
              </div>
              <p className="text-xs font-semibold text-foreground">{weakest.label}</p>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                {ACTION_MESSAGES[weakest.key]}
              </p>
            </div>
          )}

          {/* Mini-barras de las 5 variables */}
          <div className="space-y-1.5 flex-1">
            {donutData.map((seg) => {
              const pct = Math.max(0, Math.min(100, (seg.value / 25) * 100));
              return (
                <div key={seg.key} className="flex items-center gap-2" title={seg.hint}>
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">
                    {seg.name}
                  </span>
                  <div className="w-16 h-1 rounded-full bg-muted overflow-hidden shrink-0">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: seg.color }}
                    />
                  </div>
                  <span className="text-[10px] font-medium tabular-nums w-8 text-right text-foreground">
                    {seg.value.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-3">
            Ver análisis completo <ArrowRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
