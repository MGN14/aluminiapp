import { useState, useMemo, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Shield, TrendingUp, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useFinancialHealthScore, getScoreInterpretation, getRecommendations, type ScoreDetails } from '@/hooks/useFinancialHealthScore';
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
  { key: 'conciliacion', label: 'Conciliación Bancaria', color: SCORE_COLORS.conciliacion, icon: CheckCircle },
  { key: 'facturacion', label: 'Facturación Soportada', color: SCORE_COLORS.facturacion, icon: CheckCircle },
  { key: 'impuestos', label: 'Control de Impuestos', color: SCORE_COLORS.impuestos, icon: AlertTriangle },
  { key: 'cartera', label: 'Cartera y Anticipos', color: SCORE_COLORS.cartera, icon: AlertTriangle },
  { key: 'clasificacion', label: 'Clasificación Financiera', color: SCORE_COLORS.clasificacion, icon: Info },
] as const;

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function getVariableExplanation(key: string, details: ScoreDetails): { formula: string; explanation: string } {
  switch (key) {
    case 'conciliacion': {
      const d = details.conciliacion;
      return {
        formula: `${pct(d.pct)} conciliado`,
        explanation: `Del total de movimientos bancarios (${fmt(d.totalMovimientos)}), quedan ${fmt(d.montoPendiente)} sin identificar. Se calcula sobre montos, no conteo de filas.`,
      };
    }
    case 'facturacion': {
      const d = details.facturacion;
      return {
        formula: `${pct(d.pct)} soportado`,
        explanation: `De ${fmt(d.totalIngresos)} en ingresos, ${fmt(d.ingresosConFactura)} tienen factura y ${fmt(d.ingresosAnticipo)} están marcados como anticipo.`,
      };
    }
    case 'impuestos': {
      const d = details.impuestos;
      return {
        formula: `${pct(d.pct)} completitud fiscal`,
        explanation: `Promedio de: facturas de venta registradas (${pct(d.pctVentas)}), facturas de compra (${pct(d.pctCompras)}) y movimientos vinculados (${pct(d.pctVinculados)}).`,
      };
    }
    case 'cartera': {
      const d = details.cartera;
      return {
        formula: `${pct(d.pct)} riesgo promedio`,
        explanation: `Cartera pendiente: ${fmt(d.cuentasPorCobrar)} de ${fmt(d.facturacionTotal)} facturado (${pct(d.pctCartera)}). Anticipos sin factura: ${fmt(d.anticiposSinFactura)} de ${fmt(d.ingresosTotal)} ingresos (${pct(d.pctAnticipos)}).`,
      };
    }
    case 'clasificacion': {
      const d = details.clasificacion;
      return {
        formula: `${pct(d.pct)} completas`,
        explanation: `${d.completas} de ${d.total} transacciones tienen categoría, responsable (o N/A) y factura (o N/A) asignados.`,
      };
    }
    default:
      return { formula: '', explanation: '' };
  }
}

function getVariableRecommendation(key: string, score: number): string | null {
  if (key === 'conciliacion' && score < 18) return 'Existen movimientos bancarios sin soporte. Revisa y vincula facturas, asigna responsables o clasifícalos correctamente.';
  if (key === 'facturacion' && score < 18) return 'Hay ingresos sin factura asociada ni marcados como anticipo. Esto puede generar inconsistencias frente a la DIAN.';
  if (key === 'impuestos' && score < 16) return 'La base fiscal del periodo está incompleta. Faltan facturas de compra o venta que afectan el cálculo del IVA y retenciones.';
  if (key === 'cartera' && score < 18) return 'Una parte importante de tu facturación no ha sido cobrada o tienes anticipos sin factura asociada.';
  if (key === 'clasificacion' && score < 18) return 'Varias transacciones no tienen categoría, responsable o factura asignada. Completa la información para mejorar tu orden.';
  return null;
}

export default function FinancialHealth() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [initialLoading, setInitialLoading] = useState(true);

  // Default to latest month with transaction data
  useEffect(() => {
    async function findLatestMonth() {
      try {
        const { data } = await supabase
          .from('transactions')
          .select('date')
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          const d = new Date(data[0].date);
          setYear(d.getFullYear());
          setMonth(d.getMonth() + 1);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setInitialLoading(false);
      }
    }
    findLatestMonth();
  }, []);

  const { scores, details, history, loading, interpretation, recommendations, hasData } = useFinancialHealthScore(year, month);

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
        {scores && details && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {VARIABLES.map(v => {
              const value = scores[v.key as keyof typeof scores] as number;
              const pctBar = Math.round((value / 20) * 100);
              const barColor = value >= 18 ? 'bg-success' : value >= 15 ? 'bg-success/70' : value >= 10 ? 'bg-warning' : 'bg-destructive';
              const info = getVariableExplanation(v.key, details);
              const rec = getVariableRecommendation(v.key, value);
              return (
                <Card key={v.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                      {v.label}
                    </CardTitle>
                    <CardDescription className="text-xs font-semibold">{info.formula}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-bold">{value}</span>
                      <span className="text-sm text-muted-foreground">/20</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pctBar}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">{info.explanation}</p>
                    {rec && (
                      <div className="flex items-start gap-1.5 pt-1">
                        <AlertTriangle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                        <p className="text-[11px] text-warning leading-snug">{rec}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

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
