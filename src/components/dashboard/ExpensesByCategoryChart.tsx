import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCategoryColor } from '@/lib/chartColors';
import {
  ChartFilterBar, useChartFilterParam, type FilterControlSpec,
} from '@/components/dashboard/ChartFilterBar';

interface CategoryData {
  category: string;
  categoryKey: string;
  value: number;
  count: number;
}

interface ExpensesByCategoryChartProps {
  data: CategoryData[];
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
}

type TopN = '5' | '10' | 'all';
type Viz = 'bars' | 'donut';
type SortBy = 'value' | 'count';

const CHART_ID = 'exp';

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
function toIsoDate(d: Date) { return d.toISOString().split('T')[0]; }

export function ExpensesByCategoryChart({ data, periodLabel, periodStart, periodEnd }: ExpensesByCategoryChartProps) {
  const navigate = useNavigate();
  const [topN, setTopN] = useChartFilterParam<TopN>(CHART_ID, 'topN', '10', ['5', '10', 'all']);
  const [viz, setViz] = useChartFilterParam<Viz>(CHART_ID, 'viz', 'bars', ['bars', 'donut']);
  const [sortBy, setSortBy] = useChartFilterParam<SortBy>(CHART_ID, 'sort', 'value', ['value', 'count']);

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => sortBy === 'value' ? b.value - a.value : b.count - a.count);
    if (topN === 'all') return sorted;
    const n = Number(topN);
    if (sorted.length <= n) return sorted;
    const head = sorted.slice(0, n);
    const tail = sorted.slice(n);
    const otros = tail.reduce((acc, x) => ({ value: acc.value + x.value, count: acc.count + x.count }), { value: 0, count: 0 });
    return [...head, { category: `Otros (${tail.length})`, categoryKey: '__otros__', value: otros.value, count: otros.count }];
  }, [data, sortBy, topN]);

  const totals = useMemo(() => ({
    value: data.reduce((s, d) => s + d.value, 0),
    count: data.reduce((s, d) => s + d.count, 0),
  }), [data]);

  const controls: FilterControlSpec[] = [
    {
      kind: 'select', id: 'topN', label: 'Top', value: topN, onChange: setTopN, width: 110,
      options: [
        { value: '5', label: 'Top 5' }, { value: '10', label: 'Top 10' }, { value: 'all', label: 'Todas' },
      ],
    },
    {
      kind: 'toggle', id: 'viz', label: 'Vista', value: viz, onChange: setViz,
      options: [{ value: 'bars', label: 'Barras' }, { value: 'donut', label: 'Donut' }],
    },
    {
      kind: 'select', id: 'sort', label: 'Orden', value: sortBy, onChange: setSortBy, width: 130,
      options: [{ value: 'value', label: 'Por monto' }, { value: 'count', label: 'Por # tx' }],
    },
  ];

  const navigateToCategory = (categoryKey: string, categoryLabel: string) => {
    if (categoryKey === '__otros__') return;
    const params = new URLSearchParams({
      category: categoryLabel, from: toIsoDate(periodStart), to: toIsoDate(periodEnd),
    });
    navigate(`/transactions?${params.toString()}`);
  };

  if (data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-lg">¿En qué se va la plata?</CardTitle>
            <p className="text-sm text-muted-foreground">Egresos por categoría • {periodLabel}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">Sin egresos categorizados</div>
        </CardContent>
      </Card>
    );
  }

  const TooltipContent = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryData }> }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    const pctValue = totals.value > 0 ? (row.value / totals.value) * 100 : 0;
    return (
      <div className="rounded-lg border bg-card p-3 text-xs shadow-md" style={{ minWidth: 200 }}>
        <p className="font-semibold text-foreground mb-1.5">{row.category}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Monto</span><span className="font-medium text-foreground tabular-nums">{formatCurrency(row.value)}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">% del total</span><span className="tabular-nums">{pctValue.toFixed(1)}%</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground"># transacciones</span><span className="tabular-nums">{row.count}</span></div>
        </div>
      </div>
    );
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg">¿En qué se va la plata?</CardTitle>
          <p className="text-sm text-muted-foreground truncate">Egresos por categoría • {periodLabel}</p>
        </div>
        <ChartFilterBar chartId={CHART_ID} controls={controls} />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          {viz === 'bars' ? (
            <BarChart data={sortedData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis type="category" dataKey="category" tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={60} interval={0} />
              <YAxis type="number" tickFormatter={formatCurrencyShort} tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={60} />
              <Tooltip content={<TooltipContent />} cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.3 }} />
              <Bar dataKey="value" name="Monto" radius={[4, 4, 0, 0]} maxBarSize={60}
                onClick={(p: { categoryKey?: string; category?: string }) => p?.categoryKey && p?.category && navigateToCategory(p.categoryKey, p.category)}
                cursor="pointer">
                {sortedData.map(entry => <Cell key={entry.categoryKey} fill={getCategoryColor(entry.categoryKey)} />)}
              </Bar>
            </BarChart>
          ) : (
            <PieChart>
              <Tooltip content={<TooltipContent />} />
              <Pie data={sortedData} dataKey="value" nameKey="category" cx="50%" cy="50%" innerRadius={62} outerRadius={108} paddingAngle={1.5} stroke="hsl(var(--card))" strokeWidth={2}
                onClick={(p: { categoryKey?: string; category?: string }) => p?.categoryKey && p?.category && navigateToCategory(p.categoryKey, p.category)}
                cursor="pointer">
                {sortedData.map(entry => <Cell key={entry.categoryKey} fill={getCategoryColor(entry.categoryKey)} />)}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 mt-2">
          {sortedData.map(entry => {
            const pct = totals.value > 0 ? (entry.value / totals.value) * 100 : 0;
            return (
              <button key={entry.categoryKey}
                onClick={() => navigateToCategory(entry.categoryKey, entry.category)}
                disabled={entry.categoryKey === '__otros__'}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:cursor-default disabled:hover:text-muted-foreground"
                aria-label={`Ver transacciones de ${entry.category}`}>
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: getCategoryColor(entry.categoryKey) }} />
                <span className="truncate max-w-[140px]">{entry.category}</span>
                <span className="tabular-nums opacity-70">{pct.toFixed(0)}%</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
