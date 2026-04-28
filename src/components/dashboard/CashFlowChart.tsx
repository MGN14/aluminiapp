import { useMemo } from 'react';
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_COLORS } from '@/lib/chartColors';
import { parseLocalDate } from '@/lib/dateUtils';
import {
  ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec,
} from '@/components/dashboard/ChartFilterBar';

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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}
function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}
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
        bucketKey: b.key, label, balance: b.balance, delta,
        positiveArea: showZones && delta >= 0 ? b.balance : null,
        negativeArea: showZones && delta < 0 ? b.balance : null,
        marker: isMarker ? b.balance : null,
        markerKind: isMarker ? (b.maxAbsAmount > 0 ? 'in' : 'out') : null,
        markerAmount: b.maxAbsAmount,
      };
    });
  }, [dailySeries, granularity, showZones, markerThreshold]);

  const controls: FilterControlSpec[] = [
    {
      kind: 'toggle', id: 'granularity', label: 'Granularidad', value: granularity, onChange: setGranularity,
      options: [
        { value: 'daily', label: 'Diario' }, { value: 'weekly', label: 'Semanal' }, { value: 'monthly', label: 'Mensual' },
      ],
    },
    { kind: 'switch', id: 'zones', label: 'Zonas color', value: showZones, onChange: setShowZones },
  ];

  if (rows.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-lg">Saldo en el tiempo</CardTitle>
            <p className="text-sm text-muted-foreground">Flujo de caja • {periodLabel}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">Sin datos de saldo bancario para este período</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-lg">Saldo en el tiempo</CardTitle>
          <p className="text-sm text-muted-foreground truncate">
            Flujo de caja {granularity === 'daily' ? 'diario' : granularity === 'weekly' ? 'semanal' : 'mensual'} • {periodLabel}
          </p>
        </div>
        <ChartFilterBar chartId={CHART_ID} controls={controls} />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={rows} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="cashflow-positive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.income} stopOpacity={0.32} />
                <stop offset="100%" stopColor={CHART_COLORS.income} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="cashflow-negative" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.expense} stopOpacity={0.32} />
                <stop offset="100%" stopColor={CHART_COLORS.expense} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} minTickGap={20} />
            <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={60} />
            <Tooltip
              cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as CashRow;
                const isUp = row.delta >= 0;
                return (
                  <div className="rounded-lg border bg-card p-3 text-xs shadow-md" style={{ minWidth: 200 }}>
                    <p className="font-semibold text-foreground mb-2">{label}</p>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Saldo</span><span className="font-medium text-foreground tabular-nums">{formatCurrency(row.balance)}</span></div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Δ vs anterior</span>
                        <span className="tabular-nums font-medium" style={{ color: isUp ? CHART_COLORS.income : CHART_COLORS.expense }}>
                          {isUp ? '▲' : '▼'} {formatCurrencyShort(Math.abs(row.delta))}
                        </span>
                      </div>
                      {row.markerKind && (
                        <div className="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-border">
                          <span className="text-muted-foreground">Mov. clave</span>
                          <span className="tabular-nums" style={{ color: row.markerKind === 'in' ? CHART_COLORS.income : CHART_COLORS.expense }}>
                            {row.markerKind === 'in' ? '+' : '−'}{formatCurrencyShort(Math.abs(row.markerAmount))}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={avgBalance} stroke="hsl(220, 9%, 46%)" strokeDasharray="4 4" strokeWidth={1.25} strokeOpacity={0.55} ifOverflow="extendDomain"
              label={{ value: `Prom. ${formatCurrencyShort(avgBalance)}`, position: 'right', fill: 'hsl(220, 9%, 46%)', fontSize: 10 }} />
            {showZones && (<>
              <Area type="monotone" dataKey="positiveArea" stroke="none" fill="url(#cashflow-positive)" isAnimationActive={false} connectNulls={false} />
              <Area type="monotone" dataKey="negativeArea" stroke="none" fill="url(#cashflow-negative)" isAnimationActive={false} connectNulls={false} />
            </>)}
            <Line type="monotone" dataKey="balance" name="Saldo" stroke={CHART_COLORS.income} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
            {granularity === 'daily' && (
              <Scatter dataKey="marker" fill={CHART_COLORS.income}
                shape={(props: { cx?: number; cy?: number; payload?: CashRow }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload?.markerKind) return <g />;
                  const color = payload.markerKind === 'in' ? CHART_COLORS.income : CHART_COLORS.expense;
                  return (
                    <g>
                      <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.18} />
                      <circle cx={cx} cy={cy} r={2.5} fill={color} />
                    </g>
                  );
                }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
