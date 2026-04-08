import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFinancialHealthScore, getScoreInterpretation } from '@/hooks/useFinancialHealthScore';
import { Skeleton } from '@/components/ui/skeleton';

const SCORE_COLORS = {
  conciliacion: 'hsl(217, 91%, 60%)',
  facturacion: 'hsl(152, 69%, 40%)',
  impuestos: 'hsl(25, 95%, 53%)',
  cartera: 'hsl(280, 84%, 60%)',
  clasificacion: 'hsl(220, 13%, 50%)',
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
  const { scores, loading } = useFinancialHealthScore(year, month);

  const donutData = useMemo(() => {
    if (!scores) return [];
    const keys = ['conciliacion', 'facturacion', 'impuestos', 'cartera', 'clasificacion'] as const;
    return keys.map(key => ({
      name: SEGMENT_LABELS[key],
      value: scores[key],
      color: SCORE_COLORS[key],
    }));
  }, [scores]);

  const bgValue = scores ? Math.max(0, 100 - scores.total) : 100;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!scores) return null;

  const interp = getScoreInterpretation(scores.total);

  return (
    <Link to="/financial-health" className="block group">
      <Card className="overflow-hidden border border-border hover:border-primary/20 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {/* Donut */}
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

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Visita DIAN</p>
              <p className={`text-sm font-semibold ${interp.color}`}>{interp.level}</p>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {donutData.map(seg => (
                  <div key={seg.name} className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="text-[9px] text-muted-foreground">{seg.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-0.5">
                Ver análisis completo <ArrowRight className="h-3 w-3" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
