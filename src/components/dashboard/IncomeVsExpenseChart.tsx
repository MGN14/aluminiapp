import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';
import { CHART_COLORS } from '@/lib/chartColors';
import { ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec } from '@/components/dashboard/ChartFilterBar';
import {
  ChartHeader, ChartLegend, ChartDataTable, ChartEmpty, TipBox, TipRow,
  CHART_HEIGHT, BAR_MAX, BAR_RADIUS, gridProps, xAxisProps, yAxisProps, hoverCursor, fmtCopFull, fmtCopShort,
} from './chartKit';

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

function formatDelta(curr: number, prev: number) {
  if (prev === 0) return curr === 0 ? '—' : '+∞';
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

interface EnrichedRow extends MonthlyData {
  neto: number;
  ingresosVsPrev: string;
  egresosVsPrev: string;
}

export function IncomeVsExpenseChart({ data, periodLabel }: IncomeVsExpenseChartProps) {
  const navigate = useNavigate();
  const [seriesMode, setSeriesMode] = useChartFilterParam<SeriesMode>(CHART_ID, 'series', 'both', ['both', 'ingresos', 'egresos']);
  const [viewMode, setViewMode] = useChartFilterParam<ViewMode>(CHART_ID, 'view', 'monthly', ['monthly', 'accumulated']);
  const [showNet, setShowNet] = useChartFilterBool(CHART_ID, 'net', false);
  const [showTable, setShowTable] = useChartFilterBool(CHART_ID, 'table', false);

  const averages = useMemo(() => {
    if (data.length === 0) return { ingresos: 0, egresos: 0 };
    return {
      ingresos: data.reduce((s, d) => s + d.ingresos, 0) / data.length,
      egresos: data.reduce((s, d) => s + d.egresos, 0) / data.length,
    };
  }, [data]);

  const chartData: EnrichedRow[] = useMemo(() => {
    let accIn = 0;
    let accEg = 0;
    return data.map((d, idx) => {
      const prev = data[idx - 1];
      const ingresos = viewMode === 'accumulated' ? (accIn += d.ingresos) : d.ingresos;
      const egresos = viewMode === 'accumulated' ? (accEg += d.egresos) : d.egresos;
      return {
        ...d, ingresos, egresos, neto: ingresos - egresos,
        ingresosVsPrev: prev ? formatDelta(d.ingresos, prev.ingresos) : '—',
        egresosVsPrev: prev ? formatDelta(d.egresos, prev.egresos) : '—',
      };
    });
  }, [data, viewMode]);

  const showIngresos = seriesMode === 'both' || seriesMode === 'ingresos';
  const showEgresos = seriesMode === 'both' || seriesMode === 'egresos';

  const controls: FilterControlSpec[] = [
    { kind: 'toggle', id: 'series', label: 'Series', value: seriesMode, onChange: setSeriesMode,
      options: [{ value: 'both', label: 'Ambos' }, { value: 'ingresos', label: 'Ingresos' }, { value: 'egresos', label: 'Egresos' }] },
    { kind: 'toggle', id: 'view', label: 'Vista', value: viewMode, onChange: setViewMode,
      options: [{ value: 'monthly', label: 'Mensual' }, { value: 'accumulated', label: 'Acumulado' }] },
    { kind: 'switch', id: 'net', label: 'Línea de neto', value: showNet, onChange: setShowNet },
    { kind: 'switch', id: 'table', label: 'Ver como tabla', value: showTable, onChange: setShowTable },
  ];

  const handleBarClick = (type: 'ingreso' | 'egreso') => (payload: { monthKey?: string }) => {
    if (!payload?.monthKey) return;
    navigate(`/transactions?month=${payload.monthKey}&type=${type}`);
  };

  const legend = [
    ...(showIngresos ? [{ color: CHART_COLORS.income, label: 'Ingresos', shape: 'rect' as const }] : []),
    ...(showEgresos ? [{ color: CHART_COLORS.expense, label: 'Egresos', shape: 'rect' as const }] : []),
    ...(showNet ? [{ color: CHART_COLORS.projection, label: 'Neto', shape: 'line' as const }] : []),
    ...(viewMode === 'monthly' && showIngresos ? [{ color: CHART_COLORS.income, label: 'Prom. ingresos', shape: 'dash' as const, value: fmtCopShort(averages.ingresos) }] : []),
    ...(viewMode === 'monthly' && showEgresos ? [{ color: CHART_COLORS.expense, label: 'Prom. egresos', shape: 'dash' as const, value: fmtCopShort(averages.egresos) }] : []),
  ];

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <ChartHeader
        icon={BarChart3}
        title="Ingresos vs Egresos"
        subtitle={`${viewMode === 'accumulated' ? 'Acumulado' : 'Mes a mes'} · ${periodLabel} · movimientos del banco`}
        right={<ChartFilterBar chartId={CHART_ID} controls={controls} />}
      />
      <CardContent>
        {data.length === 0 ? (
          <ChartEmpty>Sin movimientos para graficar</ChartEmpty>
        ) : showTable ? (
          <ChartDataTable
            rows={chartData}
            rowKey={(r) => r.monthKey}
            columns={[
              { key: 'month', header: 'Mes', render: (r) => <span className="font-medium text-foreground">{r.month}</span> },
              { key: 'ing', header: 'Ingresos', align: 'right', render: (r) => fmtCopFull(r.ingresos) },
              { key: 'egr', header: 'Egresos', align: 'right', render: (r) => fmtCopFull(r.egresos) },
              { key: 'neto', header: 'Neto', align: 'right', render: (r) => <span className={r.neto >= 0 ? 'text-success font-semibold' : 'text-destructive font-semibold'}>{fmtCopFull(r.neto)}</span> },
            ]}
            footer={{ month: 'Total', monthKey: '__total', ingresos: chartData.reduce((s, r) => s + r.ingresos, 0), egresos: chartData.reduce((s, r) => s + r.egresos, 0), neto: chartData.reduce((s, r) => s + r.neto, 0), ingresosVsPrev: '', egresosVsPrev: '' }}
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }} barGap={2} barCategoryGap="28%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...xAxisProps} />
                <YAxis tickFormatter={fmtCopShort} {...yAxisProps} />
                <Tooltip
                  cursor={hoverCursor}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as EnrichedRow;
                    return (
                      <TipBox title={String(label)}>
                        {showIngresos && <TipRow color={CHART_COLORS.income} label="Ingresos" value={fmtCopFull(row.ingresos)} sub={viewMode === 'monthly' ? row.ingresosVsPrev : undefined} />}
                        {showEgresos && <TipRow color={CHART_COLORS.expense} label="Egresos" value={fmtCopFull(row.egresos)} sub={viewMode === 'monthly' ? row.egresosVsPrev : undefined} />}
                        <TipRow label="Neto" value={<span className={row.neto >= 0 ? 'text-success' : 'text-destructive'}>{fmtCopFull(row.neto)}</span>} className="pt-1.5 mt-1 border-t border-border" />
                      </TipBox>
                    );
                  }}
                />
                {viewMode === 'monthly' && showIngresos && (
                  <ReferenceLine y={averages.ingresos} stroke={CHART_COLORS.income} strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.55} ifOverflow="extendDomain" />
                )}
                {viewMode === 'monthly' && showEgresos && (
                  <ReferenceLine y={averages.egresos} stroke={CHART_COLORS.expense} strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.55} ifOverflow="extendDomain" />
                )}
                {showIngresos && <Bar dataKey="ingresos" name="Ingresos" fill={CHART_COLORS.income} radius={BAR_RADIUS} maxBarSize={BAR_MAX} onClick={handleBarClick('ingreso')} cursor="pointer" />}
                {showEgresos && <Bar dataKey="egresos" name="Egresos" fill={CHART_COLORS.expense} radius={BAR_RADIUS} maxBarSize={BAR_MAX} onClick={handleBarClick('egreso')} cursor="pointer" />}
                {showNet && (
                  <Line type="monotone" dataKey="neto" name="Neto" stroke={CHART_COLORS.projection} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    dot={{ r: 4, fill: CHART_COLORS.projection, stroke: 'hsl(var(--card))', strokeWidth: 2 }} activeDot={{ r: 6, stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <ChartLegend items={legend} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
