import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_COLORS } from '@/lib/chartColors';
import {
  ChartFilterBar,
  useChartFilterBool,
  useChartFilterParam,
  type FilterControlSpec,
} from '@/components/dashboard/ChartFilterBar';

interface MonthlyData {
  month: string;
  monthKey: string;
  ingresos: number;
  egresos: number;
}

interface IncomeVsExpenseChartProps {
  data: MonthlyData[];
  periodLabel: string;
}

type SeriesMode = 'both' | 'ingresos' | 'egresos';
type ViewMode = 'monthly' | 'accumulated';

const CHART_ID = 'inc';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatDelta(curr: number, prev: number) {
  if (prev === 0) return curr === 0 ? '—' : '+∞';
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

interface EnrichedRow extends MonthlyData {
  neto: number;
  ingresosVsAvg: number;
  egresosVsAvg: number;
  ingresosVsPrev: string;
  egresosVsPrev: string;
}

export function IncomeVsExpenseChart({ data, periodLabel }: IncomeVsExpenseChartProps) {
  const navigate = useNavigate();

  const [seriesMode, setSeriesMode] = useChartFilterParam<SeriesMode>(
    CHART_ID, 'series', 'both', ['both', 'ingresos', 'egresos'],
  );
  const [viewMode, setViewMode] = useChartFilterParam<ViewMode>(
    CHART_ID, 'view', 'monthly', ['monthly', 'accumulated'],
  );
  const [showNet, setShowNet] = useChartFilterBool(CHART_ID, 'net', false);

  const averages = useMemo(() => {
    if (data.length === 0) return { ingresos: 0, egresos: 0 };
    const totIn = data.reduce((s, d) => s + d.ingresos, 0);
    const totEg = data.reduce((s, d) => s + d.egresos, 0);
    return { ingresos: totIn / data.length, egresos: totEg / data.length };
  }, [data]);

  const chartData: EnrichedRow[] = useMemo(() => {
    let accIn = 0;
    let accEg = 0;
    return data.map((d, idx) => {
      const prev = data[idx - 1];
      const ingresos = viewMode === 'accumulated' ? (accIn += d.ingresos) : d.ingresos;
      const egresos = viewMode === 'accumulated' ? (accEg += d.egresos) : d.egresos;
      return {
        ...d,
        ingresos,
        egresos,
        neto: ingresos - egresos,
        ingresosVsAvg: d.ingresos - averages.ingresos,
        egresosVsAvg: d.egresos - averages.egresos,
        ingresosVsPrev: prev ? formatDelta(d.ingresos, prev.ingresos) : '—',
        egresosVsPrev: prev ? formatDelta(d.egresos, prev.egresos) : '—',
      };
    });
  }, [data, viewMode, averages]);

  const showIngresos = seriesMode === 'both' || seriesMode === 'ingresos';
  const showEgresos = seriesMode === 'both' || seriesMode === 'egresos';

  const controls: FilterControlSpec[] = [
    {
      kind: 'toggle', id: 'series', label: 'Series', value: seriesMode, onChange: setSeriesMode,
      options: [
        { value: 'both', label: 'Ambos' },
        { value: 'ingresos', label: 'Ingresos' },
        { value: 'egresos', label: 'Egresos' },
      ],
    },
    {
      kind: 'toggle', id: 'view', label: 'Vista', value: viewMode, onChange: setViewMode,
      options: [
        { value: 'monthly', label: 'Mensual' },
        { value: 'accumulated', label: 'Acumulado' },
      ],
    },
    { kind: 'switch', id: 'net', label: 'Utilidad neta', value: showNet, onChange: setShowNet },
  ];

  const handleBarClick = (type: 'ingreso' | 'egreso') => (payload: { monthKey?: string }) => {
    if (!payload?.monthKey) return;
    navigate(`/transactions?month=${payload.monthKey}&type=${type}`);
  };

  if (data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-lg">Ingresos vs Egresos</CardTitle>
            <p className="text-sm text-muted-foreground">Comparación mes a mes • {periodLabel}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            Sin datos para graficar
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg">Ingresos vs Egresos</CardTitle>
          <p className="text-sm text-muted-foreground truncate">
            {viewMode === 'accumulated' ? 'Acumulado' : 'Mes a mes'} • {periodLabel}
          </p>
        </div>
        <ChartFilterBar chartId={CHART_ID} controls={controls} />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }} barCategoryGap="15%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={60} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.25 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as EnrichedRow;
                return (
                  <div className="rounded-lg border bg-card p-3 text-xs shadow-md" style={{ minWidth: 200 }}>
                    <p className="font-semibold text-foreground mb-2">{label}</p>
                    <div className="space-y-1.5">
                      {showIngresos && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-sm" style={{ background: CHART_COLORS.income }} />
                            Ingresos
                          </span>
                          <span className="font-medium text-foreground tabular-nums">{formatCurrency(row.ingresos)}</span>
                        </div>
                      )}
                      {showIngresos && viewMode === 'monthly' && (
                        <>
                          <div className="flex items-center justify-between gap-3 pl-3.5 text-muted-foreground">
                            <span>vs mes ant.</span>
                            <span className="tabular-nums">{row.ingresosVsPrev}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 pl-3.5 text-muted-foreground">
                            <span>vs promedio</span>
                            <span className="tabular-nums">
                              {row.ingresosVsAvg >= 0 ? '+' : ''}{formatCurrencyShort(row.ingresosVsAvg)}
                            </span>
                          </div>
                        </>
                      )}
                      {showEgresos && (
                        <div className="flex items-center justify-between gap-3 pt-1">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-sm" style={{ background: CHART_COLORS.expense }} />
                            Egresos
                          </span>
                          <span className="font-medium text-foreground tabular-nums">{formatCurrency(row.egresos)}</span>
                        </div>
                      )}
                      {showEgresos && viewMode === 'monthly' && (
                        <>
                          <div className="flex items-center justify-between gap-3 pl-3.5 text-muted-foreground">
                            <span>vs mes ant.</span>
                            <span className="tabular-nums">{row.egresosVsPrev}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 pl-3.5 text-muted-foreground">
                            <span>vs promedio</span>
                            <span className="tabular-nums">
                              {row.egresosVsAvg >= 0 ? '+' : ''}{formatCurrencyShort(row.egresosVsAvg)}
                            </span>
                          </div>
                        </>
                      )}
                      {showNet && (
                        <div className="flex items-center justify-between gap-3 pt-1.5 mt-1.5 border-t border-border">
                          <span className="font-medium">Neto</span>
                          <span className="font-semibold tabular-nums" style={{ color: row.neto >= 0 ? CHART_COLORS.income : CHART_COLORS.expense }}>
                            {formatCurrency(row.neto)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              formatter={value => value === 'ingresos' ? 'Ingresos' : value === 'egresos' ? 'Egresos' : 'Utilidad neta'}
              iconType="square" wrapperStyle={{ fontSize: 12 }}
            />
            {viewMode === 'monthly' && showIngresos && (
              <ReferenceLine y={averages.ingresos} stroke={CHART_COLORS.incomeAvg} strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.6} ifOverflow="extendDomain" />
            )}
            {viewMode === 'monthly' && showEgresos && (
              <ReferenceLine y={averages.egresos} stroke={CHART_COLORS.expenseAvg} strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.6} ifOverflow="extendDomain" />
            )}
            {showIngresos && (
              <Bar dataKey="ingresos" name="ingresos" fill={CHART_COLORS.income} radius={[4, 4, 0, 0]} maxBarSize={40} onClick={handleBarClick('ingreso')} cursor="pointer" />
            )}
            {showEgresos && (
              <Bar dataKey="egresos" name="egresos" fill={CHART_COLORS.expense} radius={[4, 4, 0, 0]} maxBarSize={40} onClick={handleBarClick('egreso')} cursor="pointer" />
            )}
            {showNet && (
              <Line type="monotone" dataKey="neto" name="neto" stroke="oklch(0.55 0.12 250)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: 'oklch(0.55 0.12 250)' }} activeDot={{ r: 5 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {viewMode === 'monthly' && (
          <div className="flex items-center justify-center gap-6 mt-2 text-[11px] text-muted-foreground">
            {showIngresos && (
              <div className="flex items-center gap-1.5">
                <div className="w-6 border-t-2 border-dashed" style={{ borderColor: CHART_COLORS.incomeAvg }} />
                <span>Prom. Ingresos · {formatCurrencyShort(averages.ingresos)}</span>
              </div>
            )}
            {showEgresos && (
              <div className="flex items-center gap-1.5">
                <div className="w-6 border-t-2 border-dashed" style={{ borderColor: CHART_COLORS.expenseAvg }} />
                <span>Prom. Egresos · {formatCurrencyShort(averages.egresos)}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
