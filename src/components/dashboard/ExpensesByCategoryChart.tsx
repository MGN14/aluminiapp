import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, LabelList } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { PieChart as PieIcon } from 'lucide-react';
import { getCategoryColor, seriesColor } from '@/lib/chartColors';
import { ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec } from '@/components/dashboard/ChartFilterBar';
import {
  ChartHeader, ChartDataTable, ChartEmpty, TipBox, TipRow,
  CHART_HEIGHT, gridProps, tickStyle, hoverCursor, fmtCopFull, fmtCopShort, endLabel,
} from './chartKit';

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
const OTROS_KEY = '__otros__';

function toIsoDate(d: Date) { return d.toISOString().split('T')[0]; }

export function ExpensesByCategoryChart({ data, periodLabel, periodStart, periodEnd }: ExpensesByCategoryChartProps) {
  const navigate = useNavigate();
  const [topN, setTopN] = useChartFilterParam<TopN>(CHART_ID, 'topN', '10', ['5', '10', 'all']);
  const [viz, setViz] = useChartFilterParam<Viz>(CHART_ID, 'viz', 'bars', ['bars', 'donut']);
  const [sortBy, setSortBy] = useChartFilterParam<SortBy>(CHART_ID, 'sort', 'value', ['value', 'count']);
  const [showTable, setShowTable] = useChartFilterBool(CHART_ID, 'table', false);

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => sortBy === 'value' ? b.value - a.value : b.count - a.count);
    if (topN === 'all') return sorted;
    const n = Number(topN);
    if (sorted.length <= n) return sorted;
    const head = sorted.slice(0, n);
    const tail = sorted.slice(n);
    const otros = tail.reduce((acc, x) => ({ value: acc.value + x.value, count: acc.count + x.count }), { value: 0, count: 0 });
    return [...head, { category: `Otros (${tail.length})`, categoryKey: OTROS_KEY, value: otros.value, count: otros.count }];
  }, [data, sortBy, topN]);

  const totals = useMemo(() => ({
    value: data.reduce((s, d) => s + d.value, 0),
    count: data.reduce((s, d) => s + d.count, 0),
  }), [data]);

  const controls: FilterControlSpec[] = [
    { kind: 'select', id: 'topN', label: 'Top', value: topN, onChange: setTopN, width: 110,
      options: [{ value: '5', label: 'Top 5' }, { value: '10', label: 'Top 10' }, { value: 'all', label: 'Todas' }] },
    { kind: 'toggle', id: 'viz', label: 'Vista', value: viz, onChange: setViz,
      options: [{ value: 'bars', label: 'Barras' }, { value: 'donut', label: 'Donut' }] },
    { kind: 'select', id: 'sort', label: 'Orden', value: sortBy, onChange: setSortBy, width: 130,
      options: [{ value: 'value', label: 'Por monto' }, { value: 'count', label: 'Por # tx' }] },
    { kind: 'switch', id: 'table', label: 'Ver como tabla', value: showTable, onChange: setShowTable },
  ];

  const navigateToCategory = (categoryKey: string, categoryLabel: string) => {
    if (categoryKey === OTROS_KEY) return;
    const params = new URLSearchParams({ category: categoryLabel, from: toIsoDate(periodStart), to: toIsoDate(periodEnd) });
    navigate(`/transactions?${params.toString()}`);
  };

  const pctOf = (v: number) => (totals.value > 0 ? (v / totals.value) * 100 : 0);
  const colorOf = (key: string) => (key === OTROS_KEY ? 'var(--viz-neutral)' : getCategoryColor(key));

  const TooltipContent = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryData }> }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <TipBox title={row.category}>
        <TipRow color={viz === 'donut' ? colorOf(row.categoryKey) : seriesColor(0)} label="Monto" value={fmtCopFull(row.value)} />
        <TipRow label="% del total" value={`${pctOf(row.value).toFixed(1)}%`} muted />
        <TipRow label="Transacciones" value={row.count} muted />
      </TipBox>
    );
  };

  // Barras horizontales: nombres largos a la izquierda, valor al final de cada barra.
  const barsHeight = Math.max(CHART_HEIGHT, sortedData.length * 34 + 24);

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <ChartHeader
        icon={PieIcon}
        title="¿En qué se va la plata?"
        subtitle={`Egresos por categoría · ${periodLabel} · total ${fmtCopShort(totals.value)}`}
        right={<ChartFilterBar chartId={CHART_ID} controls={controls} />}
      />
      <CardContent>
        {data.length === 0 ? (
          <ChartEmpty>Sin egresos categorizados en el período</ChartEmpty>
        ) : showTable ? (
          <ChartDataTable
            rows={sortedData}
            rowKey={(r) => r.categoryKey}
            columns={[
              { key: 'cat', header: 'Categoría', render: (r) => <span className="font-medium text-foreground">{r.category}</span> },
              { key: 'val', header: 'Monto', align: 'right', render: (r) => fmtCopFull(r.value) },
              { key: 'pct', header: '% del total', align: 'right', render: (r) => `${pctOf(r.value).toFixed(1)}%` },
              { key: 'n', header: 'Transacciones', align: 'right', render: (r) => r.count },
            ]}
            footer={{ category: 'Total', categoryKey: '__total', value: totals.value, count: totals.count }}
          />
        ) : viz === 'bars' ? (
          <ResponsiveContainer width="100%" height={barsHeight}>
            <BarChart data={sortedData} layout="vertical" margin={{ top: 4, right: 72, left: 8, bottom: 4 }} barCategoryGap="30%">
              <CartesianGrid stroke={gridProps.stroke} strokeWidth={1} horizontal={false} />
              <XAxis type="number" tickFormatter={fmtCopShort} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="category" tick={{ ...tickStyle, fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} width={150} />
              <Tooltip content={<TooltipContent />} cursor={hoverCursor} />
              <Bar dataKey="value" name="Monto" fill={seriesColor(0)} radius={[0, 4, 4, 0]} maxBarSize={22}
                onClick={(p: { categoryKey?: string; category?: string }) => p?.categoryKey && p?.category && navigateToCategory(p.categoryKey, p.category)}
                cursor="pointer">
                {sortedData.map((entry) => <Cell key={entry.categoryKey} fill={entry.categoryKey === OTROS_KEY ? 'var(--viz-neutral)' : seriesColor(0)} />)}
                <LabelList dataKey="value" content={endLabel((i) => { const r = sortedData[i]; return r ? `${fmtCopShort(r.value)} · ${pctOf(r.value).toFixed(0)}%` : null; })} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Tooltip content={<TooltipContent />} />
                <Pie data={sortedData} dataKey="value" nameKey="category" cx="50%" cy="50%" innerRadius={70} outerRadius={118} paddingAngle={1} stroke="hsl(var(--card))" strokeWidth={2}
                  onClick={(p: { categoryKey?: string; category?: string }) => p?.categoryKey && p?.category && navigateToCategory(p.categoryKey, p.category)}
                  cursor="pointer">
                  {sortedData.map((entry) => <Cell key={entry.categoryKey} fill={colorOf(entry.categoryKey)} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-1">
              {sortedData.map((entry) => (
                <button key={entry.categoryKey}
                  onClick={() => navigateToCategory(entry.categoryKey, entry.category)}
                  disabled={entry.categoryKey === OTROS_KEY}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:cursor-default disabled:hover:text-muted-foreground"
                  aria-label={`Ver transacciones de ${entry.category}`}>
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorOf(entry.categoryKey) }} />
                  <span className="truncate max-w-[140px]">{entry.category}</span>
                  <span className="tabular-nums font-medium text-foreground/80">{pctOf(entry.value).toFixed(0)}%</span>
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
