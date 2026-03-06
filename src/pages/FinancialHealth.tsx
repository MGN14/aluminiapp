import { useState, useMemo } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Shield, TrendingUp, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { useFinancialHealthScore, getScoreInterpretation, getRecommendations } from '@/hooks/useFinancialHealthScore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import nicoAvatar from '@/assets/nico-avatar.png';

const SCORE_COLORS = {
  conciliacion: 'hsl(217, 91%, 60%)',
  facturacion: 'hsl(152, 69%, 40%)',
  impuestos: 'hsl(24, 95%, 53%)',
  cartera: 'hsl(280, 84%, 60%)',
  clasificacion: 'hsl(220, 9%, 46%)',
};

const VARIABLES = [
  { key: 'conciliacion', label: 'Conciliación Bancaria', color: SCORE_COLORS.conciliacion, icon: CheckCircle,
    desc: 'Mide qué porcentaje de las transacciones bancarias tienen soporte o están correctamente conciliadas.' },
  { key: 'facturacion', label: 'Facturación Soportada', color: SCORE_COLORS.facturacion, icon: CheckCircle,
    desc: 'Mide si los ingresos bancarios están respaldados por facturación.' },
  { key: 'impuestos', label: 'Control de Impuestos', color: SCORE_COLORS.impuestos, icon: AlertTriangle,
    desc: 'Mide si el negocio tiene claridad sobre el IVA y las retenciones.' },
  { key: 'cartera', label: 'Cartera y Anticipos', color: SCORE_COLORS.cartera, icon: AlertTriangle,
    desc: 'Mide riesgo financiero y orden en ingresos.' },
  { key: 'clasificacion', label: 'Clasificación Financiera', color: SCORE_COLORS.clasificacion, icon: Info,
    desc: 'Mide qué tan organizada está la información financiera.' },
] as const;

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function FinancialHealth() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { scores, details, history, loading, interpretation, recommendations } = useFinancialHealthScore(year, month);

  const donutData = useMemo(() => {
    if (!scores) return [];
    return VARIABLES.map(v => ({
      name: v.label,
      value: scores[v.key as keyof typeof scores] as number,
      color: v.color,
    }));
  }, [scores]);

  const bgValue = scores ? Math.max(0, 100 - scores.total) : 100;

  const historyChartData = useMemo(() => {
    return history.map(h => ({
      month: MONTH_NAMES[h.month - 1],
      total: h.score_total,
    }));
  }, [history]);

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Orden Financiero
            </h1>
            <p className="text-muted-foreground text-sm">
              Evaluación de tu organización financiera frente a estándares tributarios
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[now.getFullYear() - 1, now.getFullYear()].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Score Card */}
        {scores && interpretation && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row items-center gap-8">
                {/* Donut */}
                <div className="relative w-52 h-52 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[{ value: 100 }]} dataKey="value" cx="50%" cy="50%" innerRadius={62} outerRadius={82} startAngle={90} endAngle={-270} stroke="none">
                        <Cell fill="hsl(var(--muted))" />
                      </Pie>
                      <Pie data={[...donutData, { name: 'empty', value: bgValue, color: 'transparent' }]} dataKey="value" cx="50%" cy="50%" innerRadius={62} outerRadius={82} startAngle={90} endAngle={-270} stroke="none" paddingAngle={1}>
                        {donutData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                        <Cell fill="transparent" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-bold ${interpretation.color}`}>{scores.total}</span>
                    <span className="text-xs text-muted-foreground">/100</span>
                  </div>
                </div>

                {/* Interpretation */}
                <div className="flex-1 space-y-4">
                  <div>
                    <h2 className={`text-xl font-bold ${interpretation.color}`}>{interpretation.level}</h2>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-muted/40 rounded-lg">
                    <img src={nicoAvatar} alt="Nico" className="w-8 h-8 rounded-full shrink-0 mt-0.5" />
                    <p className="text-sm text-foreground leading-relaxed">{interpretation.message}</p>
                  </div>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {donutData.map(seg => (
                      <div key={seg.name} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="text-xs text-muted-foreground">{seg.name}</span>
                        <span className="text-xs font-semibold">{seg.value}/20</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Variable Breakdown */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {scores && VARIABLES.map(v => {
            const value = scores[v.key as keyof typeof scores] as number;
            const pct = Math.round((value / 20) * 100);
            const barColor = value >= 16 ? 'bg-success' : value >= 12 ? 'bg-warning' : 'bg-destructive';
            return (
              <Card key={v.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                    {v.label}
                  </CardTitle>
                  <CardDescription className="text-xs">{v.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2 mb-2">
                    <span className="text-2xl font-bold">{value}</span>
                    <span className="text-sm text-muted-foreground">/20</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <img src={nicoAvatar} alt="Nico" className="w-6 h-6 rounded-full" />
                Recomendaciones de Nico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Historical Evolution */}
        {historyChartData.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Evolución Mensual — {year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Line type="monotone" dataKey="total" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={{ r: 4 }} name="Score Total" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
