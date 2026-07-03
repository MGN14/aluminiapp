// Panel de cashflow forecast: muestra proyección día-a-día + mes-a-mes.
// Se monta dentro de NicoPronosticos para reemplazar la fórmula simple.

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Brain, TrendingUp, TrendingDown, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { useCashflowForecastDaily, useCashflowForecastMonthly } from '@/hooks/useCashflowForecast';
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis, ReferenceLine } from 'recharts';

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const fmtMoneyShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toFixed(0);
};

const fmtDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

export default function CashflowForecastPanel() {
  const [horizon, setHorizon] = useState<30 | 60 | 90>(60);
  const daily = useCashflowForecastDaily(horizon);
  const monthly = useCashflowForecastMonthly(6);

  if (daily.isLoading || monthly.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Calculando proyección de flujo de caja…
        </CardContent>
      </Card>
    );
  }

  const days = daily.data ?? [];
  const months = monthly.data ?? [];

  if (days.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-xs text-muted-foreground">
          No hay suficientes datos para proyectar. Cargá facturas, promesas de pago o créditos para arrancar.
        </CardContent>
      </Card>
    );
  }

  // KPIs del horizonte
  const totalInflows = days.reduce((s, d) => s + d.expected_inflows, 0);
  const totalOutflows = days.reduce((s, d) => s + d.expected_outflows, 0);
  const totalNet = totalInflows - totalOutflows;
  const closingBalance = days[days.length - 1]?.cumulative_balance ?? 0;

  // Días con riesgo (balance < 0 o net negativo grande)
  const negativeDays = days.filter(d => d.cumulative_balance < 0).length;
  const firstNegativeDay = days.find(d => d.cumulative_balance < 0);

  // Datos chart
  const chartData = days.map(d => ({
    date: fmtDate(d.fecha),
    inflows: d.expected_inflows,
    outflows: -d.expected_outflows,
    net: d.net,
    balance: d.cumulative_balance,
    confidence: d.confidence,
  }));

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Pronóstico de flujo de caja
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Combina promesas de pago, facturas vivas ponderadas por score IA del cliente, créditos y el flujo operativo recurrente (ingresos y gastos de los últimos 90 días).
              </CardDescription>
            </div>
            <div className="flex gap-1">
              {[30, 60, 90].map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizon(h as 30 | 60 | 90)}
                  className={`text-xs px-2.5 py-1 rounded ${horizon === h ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
                >
                  {h}d
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* KPIs del horizonte */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded border border-success/30 bg-success/5">
              <p className="text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Entradas esperadas
              </p>
              <p className="font-bold font-mono text-success">{fmtMoney(totalInflows)}</p>
            </div>
            <div className="p-2.5 rounded border border-destructive/30 bg-destructive/5">
              <p className="text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3" /> Salidas esperadas
              </p>
              <p className="font-bold font-mono text-destructive">{fmtMoney(totalOutflows)}</p>
            </div>
            <div className={`p-2.5 rounded border ${totalNet >= 0 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
              <p className="text-muted-foreground">Neto del periodo</p>
              <p className={`font-bold font-mono ${totalNet >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtMoney(totalNet)}</p>
            </div>
            <div className={`p-2.5 rounded border ${closingBalance >= 0 ? 'border-primary/30 bg-primary/5' : 'border-destructive/30 bg-destructive/5'}`}>
              <p className="text-muted-foreground">Saldo al día {horizon}</p>
              <p className={`font-bold font-mono ${closingBalance >= 0 ? 'text-primary' : 'text-destructive'}`}>{fmtMoney(closingBalance)}</p>
            </div>
          </div>

          {/* Alerta si hay días en rojo */}
          {firstNegativeDay && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <p className="font-semibold">⚠️ Posible déficit de caja</p>
                <p>
                  Según la proyección, el {fmtDate(firstNegativeDay.fecha)} llegarías a un saldo negativo de {fmtMoney(firstNegativeDay.cumulative_balance)}.
                  Hay <strong>{negativeDays} día{negativeDays !== 1 ? 's' : ''}</strong> en rojo en los próximos {horizon} días.
                  Sugerencia: acelerá cobranza de top deudores o postergá un egreso programado.
                </p>
              </div>
            </div>
          )}

          {/* Chart diario */}
          <div className="h-72 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.floor(chartData.length / 10)} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={fmtMoneyShort}
                  width={60}
                />
                <ChartTooltip
                  formatter={(value: any, name: string) => [fmtMoney(Number(value)), name]}
                  labelFormatter={(label) => label}
                  contentStyle={{ fontSize: 11 }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Area type="monotone" dataKey="inflows" fill="oklch(0.43 0.14 155 / 0.2)" stroke="oklch(0.43 0.14 155)" name="Entradas" strokeWidth={1} />
                <Area type="monotone" dataKey="outflows" fill="oklch(0.52 0.18 25 / 0.2)" stroke="oklch(0.52 0.18 25)" name="Salidas" strokeWidth={1} />
                <Line type="monotone" dataKey="balance" stroke="oklch(0.6 0.2 250)" name="Saldo proyectado" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Resumen mensual */}
          {months.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground">Resumen mes a mes</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
                {months.slice(0, 6).map((m) => (
                  <Tooltip key={m.month_start}>
                    <TooltipTrigger asChild>
                      <div className={`p-2 rounded border text-xs ${
                        m.net >= 0
                          ? 'border-success/30 bg-success/5'
                          : 'border-destructive/30 bg-destructive/5'
                      }`}>
                        <p className="font-medium capitalize text-[11px] truncate">{m.month_label.toLowerCase()}</p>
                        <p className={`font-mono font-bold ${m.net >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {fmtMoneyShort(m.net)}
                        </p>
                        <p className="text-[9px] text-muted-foreground">{m.avg_confidence}% conf.</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      <p><strong>{m.month_label}</strong></p>
                      <p>Entradas: <span className="text-success">{fmtMoney(m.total_inflows)}</span></p>
                      <p>Salidas: <span className="text-destructive">{fmtMoney(m.total_outflows)}</span></p>
                      <p>Neto: <strong>{fmtMoney(m.net)}</strong></p>
                      <p>Saldo cierre: {fmtMoney(m.closing_balance)}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* Explicación metodológica */}
          <div className="text-[11px] text-muted-foreground italic flex items-start gap-1 pt-1">
            <Brain className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Entradas = promesas pendientes + facturas vivas × score IA cliente + ingreso operativo recurrente (promedio 90 días, sin traspasos).
              Salidas = facturas compra pendientes + cuotas de créditos + gasto operativo recurrente (promedio 90 días, sin traspasos).
              Confianza decrece con la distancia: día 1 ~90%, día 60 ~50%.
            </span>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
