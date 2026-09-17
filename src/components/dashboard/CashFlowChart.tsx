import { useMemo } from 'react';
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Activity } from 'lucide-react';
import { ChartHeader, ChartLegend, ChartDataTable, ChartEmpty, TipBox, TipRow, CHART_HEIGHT, gridProps, xAxisProps, yAxisProps, fmtCopFull, fmtCopShort } from './chartKit';
import { CHART_COLORS } from '@/lib/chartColors';
import { parseLocalDate } from '@/lib/dateUtils';
import {
  ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec,
} from '@/components/dashboard/ChartFilterBar';
import { useCashflowForecastDaily } from '@/hooks/useCashflowForecast';

interface CashFlowTx {
  date: string;
  balance: number | null;
  amount: number | null;
}

interface CashFlowChartProps {
  transactions: CashFlowTx[];
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
}

type Granularity = 'daily' | 'weekly' | 'monthly';

const CHART_ID = 'cash';

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeek(d: Date) {
  // Lunes ISO como inicio.
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const w = new Date(d);
  w.setDate(w.getDate() - diff);
  w.setHours(0, 0, 0, 0);
  return w;
}

interface CashRow {
  bucketKey: string;
  label: string;
  balance: number;
  /** Solo presente para filas FUTURAS (proyección). null para histórico. */
  projectedBalance: number | null;
  delta: number;
  positiveArea: number | null;
  negativeArea: number | null;
  marker: number | null;
  markerKind: 'in' | 'out' | null;
  markerAmount: number;
}

export function CashFlowChart({ transactions, periodStart, periodEnd, periodLabel }: CashFlowChartProps) {
  const [granularity, setGranularity] = useChartFilterParam<Granularity>(
    CHART_ID, 'granularity', 'daily', ['daily', 'weekly', 'monthly'],
  );
  const [showZones, setShowZones] = useChartFilterBool(CHART_ID, 'zones', true);
  const [showForecast, setShowForecast] = useChartFilterBool(CHART_ID, 'forecast', true);
  const [showTable, setShowTable] = useChartFilterBool(CHART_ID, 'table', false);

  // Forecast diario (próximos 60 días). Solo se muestra si granularity=daily.
  const forecast = useCashflowForecastDaily(60);

  const dailySeries = useMemo(() => {
    if (transactions.length === 0) return [];
    const inRange = transactions
      .filter(tx => tx.balance !== null)
      .map(tx => ({ date: parseLocalDate(tx.date), balance: tx.balance!, amount: tx.amount ?? 0 }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const beforePeriod = inRange.filter(tx => tx.date < periodStart);
    const seed = beforePeriod.length > 0 ? beforePeriod[beforePeriod.length - 1].balance : 0;
    const byDay = new Map<string, { balance: number; maxAbsAmount: number; netAmount: number }>();
    inRange.filter(tx => tx.date >= periodStart && tx.date <= periodEnd).forEach(tx => {
      const k = isoDay(tx.date);
      const prev = byDay.get(k) ?? { balance: tx.balance, maxAbsAmount: 0, netAmount: 0 };
      prev.balance = tx.balance;
      prev.netAmount += tx.amount;
      if (Math.abs(tx.amount) > Math.abs(prev.maxAbsAmount)) prev.maxAbsAmount = tx.amount;
      byDay.set(k, prev);
    });
    const out: Array<{ date: Date; key: string; balance: number; netAmount: number; maxAbsAmount: number }> = [];
    let last = seed;
    const cursor = new Date(periodStart);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(periodEnd);
    end.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      const k = isoDay(cursor);
      const day = byDay.get(k);
      if (day) last = day.balance;
      out.push({
        date: new Date(cursor), key: k, balance: last,
        netAmount: day?.netAmount ?? 0, maxAbsAmount: day?.maxAbsAmount ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [transactions, periodStart, periodEnd]);

  const avgBalance = useMemo(() => {
    if (dailySeries.length === 0) return 0;
    return dailySeries.reduce((s, d) => s + d.balance, 0) / dailySeries.length;
  }, [dailySeries]);

  const markerThreshold = Math.abs(avgBalance) * 0.05;

  const rows: CashRow[] = useMemo(() => {
    if (dailySeries.length === 0) return [];
    type Bucket = { key: string; date: Date; balance: number; maxAbsAmount: number };
    const buckets = new Map<string, Bucket>();
    const bucketKey = (d: Date) => {
      if (granularity === 'daily') return isoDay(d);
      if (granularity === 'weekly') return isoDay(startOfWeek(d));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    dailySeries.forEach(p => {
      const k = bucketKey(p.date);
      const existing = buckets.get(k);
      if (!existing) {
        buckets.set(k, { key: k, date: p.date, balance: p.balance, maxAbsAmount: p.maxAbsAmount });
      } else {
        // EOP: el balance del bucket = balance del último día.
        existing.balance = p.balance;
        existing.date = p.date;
        if (Math.abs(p.maxAbsAmount) > Math.abs(existing.maxAbsAmount)) existing.maxAbsAmount = p.maxAbsAmount;
      }
    });
    const sorted = Array.from(buckets.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    return sorted.map((b, i) => {
      const prev = i > 0 ? sorted[i - 1].balance : b.balance;
      const delta = b.balance - prev;
      const label = granularity === 'monthly'
        ? b.date.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' })
        : granularity === 'weekly'
          ? `Sem ${b.date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}`
          : b.date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
      const isMarker = granularity === 'daily' && Math.abs(b.maxAbsAmount) > markerThreshold && markerThreshold > 0;
      return {
        bucketKey: b.key, label, balance: b.balance, projectedBalance: null, delta,
        positiveArea: showZones && delta >= 0 ? b.balance : null,
        negativeArea: showZones && delta < 0 ? b.balance : null,
        marker: isMarker ? b.balance : null,
        markerKind: isMarker ? (b.maxAbsAmount > 0 ? 'in' : 'out') : null,
        markerAmount: b.maxAbsAmount,
      };
    });
  }, [dailySeries, granularity, showZones, markerThreshold]);

  // Anexar filas de PROYECCIÓN al final (solo si granularity=daily y showForecast).
  // El primer punto proyectado conecta visualmente con el último real (clonado).
  const rowsWithForecast: CashRow[] = useMemo(() => {
    if (granularity !== 'daily' || !showForecast || !forecast.data || forecast.data.length === 0) {
      return rows;
    }
    if (rows.length === 0) return rows;
    const lastReal = rows[rows.length - 1];
    // Bridge: el último real recibe también projectedBalance para que las líneas se toquen
    const bridged = [...rows];
    bridged[bridged.length - 1] = { ...lastReal, projectedBalance: lastReal.balance };

    const forecastRows: CashRow[] = forecast.data.slice(1).map((d) => {
      const date = new Date(d.fecha + 'T00:00:00');
      const label = date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
      return {
        bucketKey: `forecast-${d.fecha}`,
        label,
        balance: NaN, // no histórico
        projectedBalance: d.cumulative_balance,
        delta: d.net,
        positiveArea: null,
        negativeArea: null,
        marker: null,
        markerKind: null,
        markerAmount: 0,
      };
    });
    return [...bridged, ...forecastRows];
  }, [rows, forecast.data, granularity, showForecast]);

  const controls: FilterControlSpec[] = [
    {
      kind: 'toggle', id: 'granularity', label: 'Granularidad', value: granularity, onChange: setGranularity,
      options: [
        { value: 'daily', label: 'Diario' }, { value: 'weekly', label: 'Semanal' }, { value: 'monthly', label: 'Mensual' },
      ],
    },
    { kind: 'switch', id: 'zones', label: 'Zonas color', value: showZones, onChange: setShowZones },
    ...(granularity === 'daily' ? [{ kind: 'switch' as const, id: 'forecast', label: 'Proyección 60d', value: showForecast, onChange: setShowForecast }] : []),
    { kind: 'switch' as const, id: 'table', label: 'Ver como tabla', value: showTable, onChange: setShowTable },
  ];

  const subtitle = `Flujo de caja ${granularity === 'daily' ? 'diario' : granularity === 'weekly' ? 'semanal' : 'mensual'} · ${periodLabel} · promedio ${fmtCopShort(avgBalance)}`;
  const legend = [
    { color: CHART_COLORS.projection, label: 'Saldo', shape: 'line' as const },
    ...(granularity === 'daily' && showForecast ? [{ color: CHART_COLORS.projection, label: 'Proyección 60 días', shape: 'dash' as const }] : []),
    ...(showZones ? [{ color: CHART_COLORS.income, label: 'Sube', shape: 'rect' as const }, { color: CHART_COLORS.expense, label: 'Baja', shape: 'rect' as const }] : []),
    { color: CHART_COLORS.neutral, label: 'Promedio', shape: 'dash' as const, value: fmtCopShort(avgBalance) },
  ];

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <ChartHeader icon={Activity} title="Saldo en el tiempo" subtitle={subtitle} right={<ChartFilterBar chartId={CHART_ID} controls={controls} />} />
      <CardContent>
        {rows.length === 0 ? (
          <ChartEmpty>Sin datos de saldo bancario para este período</ChartEmpty>
        ) : showTable ? (
          <ChartDataTable
            rows={rowsWithForecast.filter((r) => !Number.isNaN(r.balance) || r.projectedBalance != null)}
            rowKey={(r) => r.bucketKey}
            columns={[
              { key: 'f', header: granularity === 'monthly' ? 'Mes' : granularity === 'weekly' ? 'Semana' : 'Día', render: (r) => <span className="font-medium text-foreground">{r.label}{r.bucketKey.startsWith('forecast-') ? ' (proy.)' : ''}</span> },
              { key: 's', header: 'Saldo', align: 'right', render: (r) => fmtCopFull(Number.isNaN(r.balance) ? (r.projectedBalance ?? 0) : r.balance) },
              { key: 'd', header: 'Variación', align: 'right', render: (r) => <span className={r.delta >= 0 ? 'text-success' : 'text-destructive'}>{r.delta >= 0 ? '+' : '−'}{fmtCopShort(Math.abs(r.delta))}</span> },
            ]}
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart data={rowsWithForecast} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="cashflow-positive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.income} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={CHART_COLORS.income} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cashflow-negative" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.expense} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={CHART_COLORS.expense} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...xAxisProps} minTickGap={24} />
                <YAxis tickFormatter={fmtCopShort} {...yAxisProps} />
                <Tooltip
                  cursor={{ stroke: CHART_COLORS.axis, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as CashRow;
                    const isUp = row.delta >= 0;
                    const esProy = row.bucketKey.startsWith('forecast-');
                    const saldo = esProy ? (row.projectedBalance ?? 0) : row.balance;
                    return (
                      <TipBox title={`${label}${esProy ? ' · proyección' : ''}`}>
                        <TipRow color={CHART_COLORS.projection} label={esProy ? 'Saldo proyectado' : 'Saldo'} value={fmtCopFull(saldo)} />
                        <TipRow label="Variación" value={<span className={isUp ? 'text-success' : 'text-destructive'}>{isUp ? '+' : '−'}{fmtCopShort(Math.abs(row.delta))}</span>} muted />
                        {row.markerKind && <TipRow label="Movimiento clave" value={<span className={row.markerKind === 'in' ? 'text-success' : 'text-destructive'}>{row.markerKind === 'in' ? '+' : '−'}{fmtCopShort(Math.abs(row.markerAmount))}</span>} muted className="pt-1.5 mt-1 border-t border-border" />}
                      </TipBox>
                    );
                  }}
                />
                <ReferenceLine y={avgBalance} stroke={CHART_COLORS.neutral} strokeDasharray="5 4" strokeWidth={1.5} strokeOpacity={0.6} ifOverflow="extendDomain" />
                {showZones && (<>
                  <Area type="monotone" dataKey="positiveArea" stroke="none" fill="url(#cashflow-positive)" isAnimationActive={false} connectNulls={false} />
                  <Area type="monotone" dataKey="negativeArea" stroke="none" fill="url(#cashflow-negative)" isAnimationActive={false} connectNulls={false} />
                </>)}
                <Line type="monotone" dataKey="balance" name="Saldo" stroke={CHART_COLORS.projection} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false}
                  activeDot={{ r: 6, fill: CHART_COLORS.projection, stroke: 'hsl(var(--card))', strokeWidth: 2 }} connectNulls={false} />
                {granularity === 'daily' && showForecast && (
                  <Line type="monotone" dataKey="projectedBalance" name="Proyección" stroke={CHART_COLORS.projection} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" dot={false} connectNulls={false} />
                )}
                {granularity === 'daily' && (
                  <Scatter dataKey="marker" fill={CHART_COLORS.income}
                    shape={(props: { cx?: number; cy?: number; payload?: CashRow }) => {
                      const { cx, cy, payload } = props;
                      if (cx == null || cy == null || !payload?.markerKind) return <g />;
                      const color = payload.markerKind === 'in' ? CHART_COLORS.income : CHART_COLORS.expense;
                      return <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="hsl(var(--card))" strokeWidth={2} />;
                    }} />
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
