import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Shield, ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFinancialHealthScore, getScoreInterpretation } from '@/hooks/useFinancialHealthScore';
import { Skeleton } from '@/components/ui/skeleton';
import nicoAvatar from '@/assets/nico-avatar.png';

const SCORE_COLORS = {
  conciliacion: 'hsl(217, 91%, 60%)',   // blue
  facturacion: 'hsl(152, 69%, 40%)',     // green
  impuestos: 'hsl(24, 95%, 53%)',        // orange
  cartera: 'hsl(280, 84%, 60%)',         // purple
  clasificacion: 'hsl(220, 9%, 46%)',    // gray
};

const SEGMENT_LABELS: Record<string, string> = {
  conciliacion: 'Conciliación',
  facturacion: 'Facturación',
  impuestos: 'Impuestos',
  cartera: 'Cartera',
  clasificacion: 'Clasificación',
};

interface Props {
  year: number;
  month: number;
}

export default function FinancialHealthCard({ year, month }: Props) {
  const { scores, loading, interpretation } = useFinancialHealthScore(year, month);

  const donutData = useMemo(() => {
    if (!scores) return [];
    const keys = ['conciliacion', 'facturacion', 'impuestos', 'cartera', 'clasificacion'] as const;
    return keys.map(key => ({
      name: SEGMENT_LABELS[key],
      value: scores[key],
      color: SCORE_COLORS[key],
    }));
  }, [scores]);

  // Background ring (remaining out of 100)
  const bgValue = scores ? Math.max(0, 100 - scores.total) : 100;

  if (loading) {
    return (
      <Card className="col-span-1 sm:col-span-2">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!scores) return null;

  const interp = getScoreInterpretation(scores.total);

  return (
    <Card className="col-span-1 sm:col-span-2 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Orden Financiero
        </CardTitle>
        <Link to="/financial-health">
          <Button variant="ghost" size="sm" className="text-xs gap-1">
            Ver análisis completo <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Donut Chart */}
          <div className="relative w-36 h-36 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {/* Background ring */}
                <Pie
                  data={[{ value: 100 }]}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={58}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                >
                  <Cell fill="hsl(var(--muted))" />
                </Pie>
                {/* Score segments */}
                <Pie
                  data={[...donutData, { name: 'empty', value: bgValue, color: 'transparent' }]}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={58}
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
            {/* Center score */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${interp.color}`}>{scores.total}</span>
              <span className="text-[10px] text-muted-foreground">/100</span>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <span className={`text-sm font-semibold ${interp.color}`}>{interp.level}</span>
            </div>
            
            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {donutData.map(seg => (
                <div key={seg.name} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-[10px] text-muted-foreground">{seg.name} ({seg.value})</span>
                </div>
              ))}
            </div>

            {/* Nico summary */}
            <div className="flex items-start gap-2 p-2 bg-muted/40 rounded-md">
              <img src={nicoAvatar} alt="Nico" className="w-5 h-5 rounded-full shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">
                {interp.message}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
