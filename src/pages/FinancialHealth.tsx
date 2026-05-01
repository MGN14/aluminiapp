import { useState, useMemo, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import CalendarioTributario from '@/components/dian/CalendarioTributario';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, AlertTriangle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useFinancialHealthScore, type ScoreDetails } from '@/hooks/useFinancialHealthScore';
import { SCORE_VARIABLES } from '@/hooks/financialHealthScoreUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import nicoAvatar from '@/assets/nico-avatar.png';
import CFOInsights from '@/components/dashboard/CFOInsights';
import { PeriodSelection } from '@/components/dashboard/UnifiedPeriodFilter';
import { useNico } from '@/hooks/useNicoContext';

const VARIABLES = SCORE_VARIABLES;

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
        explanation: `${fmt(d.montoPendiente)} sin identificar de ${fmt(d.totalMovimientos)} en movimientos.`,
      };
    }
    case 'facturacion': {
      const d = details.facturacion;
      return {
        formula: `${pct(d.pct)} soportado`,
        explanation: `${fmt(d.ingresosConFactura)} facturados de ${fmt(d.totalIngresos)} totales.`,
      };
    }
    case 'impuestos': {
      const d = details.impuestos;
      if (d.totalValueSiigo <= 0) {
        return {
          formula: 'Sin inventario cargado',
          explanation: 'Sube tu maestro de productos y realiza un conteo físico para medir el descuadre.',
        };
      }
      return {
        formula: `${pct(d.ratioDescuadre)} descuadre en costo`,
        explanation: `${fmt(d.totalDifferenceValue)} de diferencia entre Siigo y físico sobre ${fmt(d.totalValueSiigo)} en inventario (${d.productsWithDiff} de ${d.totalProducts} referencias).`,
      };
    }
    case 'cartera': {
      const d = details.cartera;
      return {
        formula: `${pct(d.pct)} riesgo`,
        explanation: `Pendiente: ${fmt(d.cuentasPorCobrar)}. Anticipos sin factura: ${fmt(d.anticiposSinFactura)}.`,
      };
    }
    case 'clasificacion': {
      // Pulmón financiero: cuántos meses de operación cubre la plata disponible
      const d = details.clasificacion;
      if (d.runwayMeses === null) {
        return {
          formula: 'Generando plata',
          explanation: `Saldo: ${fmt(d.saldoActual)}. Tus ingresos cubren los gastos — runway saludable.`,
        };
      }
      const meses = d.runwayMeses;
      const rangoTexto = meses >= 12
        ? '12+ meses (zona segura)'
        : meses >= 6 ? '6-12 meses (saludable)'
        : meses >= 3 ? '3-6 meses (atención)'
        : meses >= 1 ? '1-3 meses (urgente)'
        : 'Menos de 1 mes (crítico)';
      return {
        formula: `${meses.toFixed(1)} meses de pulmón`,
        explanation: `Saldo disponible: ${fmt(d.saldoActual)}. Gasto neto mensual: ${fmt(d.gastoNetoMensual)}. ${rangoTexto}.`,
      };
    }
    default:
      return { formula: '', explanation: '' };
  }
}

function getVariableAlert(key: string, score: number): string | null {
  if (key === 'conciliacion' && score < 18) return 'Movimientos sin soporte detectados';
  if (key === 'facturacion' && score < 18) return 'Ingresos sin factura detectados';
  if (key === 'impuestos' && score < 16) return 'Descuadre alto entre Siigo y físico';
  if (key === 'cartera' && score < 18) return 'Facturación sin cobrar o anticipos pendientes';
  if (key === 'clasificacion' && score < 18) return 'Pulmón financiero ajustado';
  return null;
}

function getRiskLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Bajo', color: 'text-success' };
  if (score >= 80) return { label: 'Moderado', color: 'text-success' };
  if (score >= 50) return { label: 'Alto', color: 'text-warning' };
  return { label: 'Crítico', color: 'text-destructive' };
}

function getNicoMessage(score: number): { line1: string; line2: string; line3: string } {
  if (score >= 90) return {
    line1: 'Todo en orden. Tu negocio está preparado.',
    line2: 'Si hoy se le aparece la DIAN, no tendrías problemas.',
    line3: 'Sigue así y mantén tu disciplina financiera.',
  };
  if (score >= 80) return {
    line1: 'Casi listo, pero hay detalles por cerrar.',
    line2: 'Podrías tener observaciones menores en una revisión.',
    line3: 'Unos ajustes más y quedas tranquilo.',
  };
  if (score >= 50) return {
    line1: 'Tienes desorden en varias áreas clave.',
    line2: 'Si hoy se le aparece la DIAN, podrías tener inconsistencias.',
    line3: 'Aún estás a tiempo de corregirlo.',
  };
  return {
    line1: 'Tu situación fiscal necesita atención urgente.',
    line2: 'Una visita de la DIAN podría resultar en sanciones.',
    line3: 'Actúa ahora para evitar multas.',
  };
}

export default function FinancialHealth() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [latestAvailableYear, setLatestAvailableYear] = useState(currentYear);
  const [initialLoading, setInitialLoading] = useState(true);
  const { openNico, setPageContext } = useNico();

  useEffect(() => {
    async function initializeYear() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [latestTx, latestInvoice] = await Promise.all([
          supabase.from('transactions').select('date').eq('user_id', user.id).is('deleted_at', null).order('date', { ascending: false }).limit(1),
          supabase.from('invoices').select('issue_date').eq('user_id', user.id).eq('status', 'confirmed').order('issue_date', { ascending: false }).limit(1),
        ]);

        if (latestTx.error) throw latestTx.error;
        if (latestInvoice.error) throw latestInvoice.error;

        const txDate = latestTx.data?.[0]?.date ? new Date(`${latestTx.data[0].date}T00:00:00`) : null;
        const invoiceDate = latestInvoice.data?.[0]?.issue_date ? new Date(`${latestInvoice.data[0].issue_date}T00:00:00`) : null;

        const latestDate = [txDate, invoiceDate].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];

        if (latestDate) {
          const detectedYear = latestDate.getFullYear();
          setLatestAvailableYear(detectedYear);
          setYear(detectedYear);
        }
      } catch (error) {
        console.error('Error loading initial financial health year:', error);
      } finally {
        setInitialLoading(false);
      }
    }
    initializeYear();
  }, []);

  const { scores, details, history, loading, interpretation, recommendations, hasData, lastMonthWithData } = useFinancialHealthScore(year);

  const now = new Date();
  const insightsPeriod: PeriodSelection = useMemo(() => ({
    type: 'year' as const,
    month: now.getMonth() + 1,
    quarter: Math.ceil((now.getMonth() + 1) / 3),
    year,
  }), [year]);

  const [hasTransactions, setHasTransactions] = useState(false);
  useEffect(() => {
    supabase.from('transactions').select('id', { count: 'exact', head: true }).is('deleted_at', null).then(({ count }) => {
      setHasTransactions((count ?? 0) > 0);
    });
  }, []);

  const yearOptions = useMemo(() => {
    const baseYear = Math.max(currentYear, latestAvailableYear);
    return Array.from({ length: 4 }, (_, i) => baseYear - i);
  }, [currentYear, latestAvailableYear]);

  const coverageLabel = useMemo(() => {
    if (!lastMonthWithData) return `Sin datos acumulados para ${year}`;
    return `Ene – ${MONTH_NAMES[lastMonthWithData - 1]} ${year}`;
  }, [lastMonthWithData, year]);

  const donutData = useMemo(() => {
    if (!scores) return [];
    return VARIABLES.map((v) => ({
      name: v.label,
      value: scores[v.key as keyof typeof scores] as number,
      color: v.color,
    }));
  }, [scores]);

  const bgValue = scores ? Math.max(0, 100 - scores.total) : 100;

  const historyChartData = useMemo(() => {
    return history.map((h) => ({
      month: MONTH_NAMES[h.month - 1],
      total: h.score_total,
    }));
  }, [history]);

  const handleAskNico = () => {
    setPageContext({ page: 'financial-health', filters: { year } });
    openNico();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nico-prefill', { detail: { message: '¿Cómo puedo mejorar mi score fiscal?' } }));
    }, 300);
  };

  if (loading || initialLoading) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 space-y-8 py-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-80 w-full rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-2xl" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  const risk = scores ? getRiskLevel(scores.total) : null;
  const nicoMsg = scores ? getNicoMessage(scores.total) : null;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 space-y-10 py-4">
        {/* Page header */}
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Estado fiscal</h1>
            <p className="text-sm text-muted-foreground mt-1">{coverageLabel}</p>
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* No data warning */}
        {!hasData && (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 flex items-center gap-4">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <p className="text-sm text-muted-foreground">
              No hay datos para {year}. Sube un extracto bancario o factura para calcular tu score.
            </p>
          </div>
        )}

        {/* Hero card */}
        {scores && interpretation && risk && nicoMsg && (
          <div className="rounded-3xl border border-border/50 bg-gradient-to-br from-card via-card to-muted/20 p-8 md:p-10 shadow-sm">
            <div className="flex flex-col md:flex-row items-center gap-10">
              {/* Donut - EXACT SAME CHART */}
              <div className="relative w-56 h-56 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ value: 100 }]} dataKey="value" cx="50%" cy="50%" innerRadius={68} outerRadius={90} startAngle={90} endAngle={-270} stroke="none">
                      <Cell fill="hsl(var(--muted))" />
                    </Pie>
                    <Pie data={[...donutData, { name: 'empty', value: bgValue, color: 'transparent' }]} dataKey="value" cx="50%" cy="50%" innerRadius={68} outerRadius={90} startAngle={90} endAngle={-270} stroke="none" paddingAngle={1}>
                      {donutData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                      <Cell fill="transparent" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-5xl font-bold tracking-tight ${interpretation.color}`}>{scores.total}</span>
                  <span className="text-sm text-muted-foreground font-medium">/100</span>
                </div>
              </div>

              {/* Info side */}
              <div className="flex-1 space-y-6 text-center md:text-left">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Nivel de riesgo</p>
                  <h2 className={`text-2xl font-bold tracking-tight ${risk.color}`}>{risk.label}</h2>
                </div>

                {/* Nico message - clean and scannable */}
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">{nicoMsg.line1}</p>
                  <p className="text-sm text-muted-foreground">{nicoMsg.line2}</p>
                  <p className="text-sm text-foreground/70">{nicoMsg.line3}</p>
                </div>

                {/* Legend - horizontal clean */}
                <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center md:justify-start">
                  {donutData.map((seg) => (
                    <div key={seg.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                      <span className="text-xs text-muted-foreground">{seg.name}</span>
                      <span className="text-xs font-bold text-foreground">{seg.value}</span>
                    </div>
                  ))}
                </div>

                {/* Ask Nico button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-2 text-success hover:text-success hover:bg-success/10 rounded-xl"
                  onClick={handleAskNico}
                >
                  <MessageCircle className="h-4 w-4" />
                  Preguntar a Nico
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Variable cards */}
        {scores && details && (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {VARIABLES.map((v) => {
              const value = scores[v.key as keyof typeof scores] as number;
              const pctBar = Math.round((value / 20) * 100);
              const barColor = value >= 18 ? 'bg-success' : value >= 15 ? 'bg-success/70' : value >= 10 ? 'bg-warning' : 'bg-destructive';
              const info = getVariableExplanation(v.key, details);
              const alert = getVariableAlert(v.key, value);

              return (
                <Card key={v.key} className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-6 space-y-4">
                    {/* Header */}
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                      <span className="text-sm font-medium text-foreground">{v.label}</span>
                    </div>

                    {/* Qué mide esta variable */}
                    <p className="text-[11px] text-muted-foreground/70 leading-snug">{v.hint}</p>

                    {/* Score */}
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold tracking-tight text-foreground">{value}</span>
                      <span className="text-sm text-muted-foreground font-medium">/ 20</span>
                    </div>

                    {/* Bar */}
                    <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pctBar}%` }} />
                    </div>

                    {/* Formula + explanation (datos actuales) */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">{info.formula}</p>
                      <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-2">{info.explanation}</p>
                    </div>

                    {/* Alert - compact Apple style */}
                    {alert && (
                      <div className="flex items-center gap-2 rounded-xl bg-warning/8 px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                        <span className="text-xs text-warning font-medium">{alert}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* CFO Insights */}
        <CFOInsights periodSelection={insightsPeriod} hasTransactions={hasTransactions} />

        {/* Evolution chart */}
        {historyChartData.length > 1 && (
          <Card className="rounded-2xl border-border/50 shadow-sm">
            <CardContent className="p-6 md:p-8">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">Evolución — {year}</h3>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12 }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Line type="monotone" dataKey="total" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={{ r: 4 }} name="Score" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      {/* Calendario Tributario */}
      <div>
        <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          📅 Calendario Tributario 2026
        </h2>
        <CalendarioTributario />
      </div>

      </div>
    </AppLayout>
  );
}
