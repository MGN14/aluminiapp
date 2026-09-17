import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Users } from 'lucide-react';
import { stableSeriesColors } from '@/lib/chartColors';
import { parseLocalDate } from '@/lib/dateUtils';
import { MONTH_NAMES } from '@/types/transaction';
import { useCounterpartyResolver, resolveCounterpartyName } from '@/lib/counterpartyResolver';
import { ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec } from '@/components/dashboard/ChartFilterBar';
import {
  ChartHeader, ChartLegend, ChartDataTable, ChartEmpty, TipBox, TipRow,
  CHART_HEIGHT, BAR_MAX, gridProps, xAxisProps, yAxisProps, hoverCursor, surfaceGap, fmtCopFull, fmtCopShort,
} from './chartKit';

interface SalesInvoiceLite {
  issue_date: string;
  total_amount: number;
  counterparty_name: string | null;
  responsible_id: string | null;
}

interface BilledByClientMonthChartProps {
  salesInvoices: SalesInvoiceLite[];
  year: number;
}

type TopN = '3' | '5' | '8';
type Layout = 'stacked' | 'grouped';

const CHART_ID = 'cli';
const OTROS = 'Otros';

export function BilledByClientMonthChart({ salesInvoices, year }: BilledByClientMonthChartProps) {
  const navigate = useNavigate();
  const [topN, setTopN] = useChartFilterParam<TopN>(CHART_ID, 'topN', '5', ['3', '5', '8']);
  const [layout, setLayout] = useChartFilterParam<Layout>(CHART_ID, 'layout', 'stacked', ['stacked', 'grouped']);
  const [showTable, setShowTable] = useChartFilterBool(CHART_ID, 'table', false);
  const counterpartyResolver = useCounterpartyResolver();

  const { data, clientKeys, colorOf, totalYear } = useMemo(() => {
    const n = Number(topN);
    const nameOf = (inv: SalesInvoiceLite) => resolveCounterpartyName(inv.counterparty_name, inv.responsible_id, counterpartyResolver);
    const totalsByClient = new Map<string, number>();
    salesInvoices.forEach(inv => {
      const c = nameOf(inv);
      totalsByClient.set(c, (totalsByClient.get(c) || 0) + (inv.total_amount || 0));
    });
    // Ranking GLOBAL (todos los clientes): fija el color de cada uno. Cambiar el
    // Top N no repinta a los que quedan — el color sigue a la entidad.
    const ranked = Array.from(totalsByClient.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const colorOf = stableSeriesColors(ranked.slice(0, 8), OTROS);
    const topClients = ranked.slice(0, n);
    const rows = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, string | number> = { month: MONTH_NAMES[i].slice(0, 3), monthKey: `${year}-${String(i + 1).padStart(2, '0')}`, __total: 0 };
      topClients.forEach(c => { row[c] = 0; });
      row[OTROS] = 0;
      return row;
    });
    let hasOthers = false;
    salesInvoices.forEach(inv => {
      const mi = parseLocalDate(inv.issue_date).getMonth();
      if (mi < 0 || mi > 11) return;
      const c = nameOf(inv);
      const isTop = topClients.includes(c);
      const key = isTop ? c : OTROS;
      if (!isTop) hasOthers = true;
      const amount = inv.total_amount || 0;
      rows[mi][key] = (Number(rows[mi][key]) || 0) + amount;
      rows[mi].__total = (Number(rows[mi].__total) || 0) + amount;
    });
    const totalYear = Array.from(totalsByClient.values()).reduce((s, v) => s + v, 0);
    return { data: rows, clientKeys: hasOthers ? [...topClients, OTROS] : topClients, colorOf, totalYear };
  }, [salesInvoices, topN, year, counterpartyResolver]);

  const controls: FilterControlSpec[] = [
    { kind: 'select', id: 'topN', label: 'Top', value: topN, onChange: setTopN, width: 110,
      options: [{ value: '3', label: 'Top 3' }, { value: '5', label: 'Top 5' }, { value: '8', label: 'Top 8' }] },
    { kind: 'toggle', id: 'layout', label: 'Vista', value: layout, onChange: setLayout,
      options: [{ value: 'stacked', label: 'Apilado' }, { value: 'grouped', label: 'Lado a lado' }] },
    { kind: 'switch', id: 'table', label: 'Ver como tabla', value: showTable, onChange: setShowTable },
  ];

  const handleSegmentClick = (clientName: string) => (p: { monthKey?: string }) => {
    if (!p?.monthKey || clientName === OTROS) return;
    navigate(`/invoices?${new URLSearchParams({ month: p.monthKey, counterparty: clientName, type: 'venta' }).toString()}`);
  };

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <ChartHeader
        icon={Users}
        title="Facturado por cliente por mes"
        subtitle={`Top ${topN} clientes · ${year} · ${fmtCopShort(totalYear)} facturados`}
        right={<ChartFilterBar chartId={CHART_ID} controls={controls} />}
      />
      <CardContent>
        {clientKeys.length === 0 ? (
          <ChartEmpty>Sin clientes facturados en {year}</ChartEmpty>
        ) : showTable ? (
          <ChartDataTable
            rows={data}
            rowKey={(r) => String(r.monthKey)}
            columns={[
              { key: 'm', header: 'Mes', render: (r) => <span className="font-medium text-foreground">{String(r.month)}</span> },
              ...clientKeys.map((c) => ({ key: c, header: c, align: 'right' as const, render: (r: Record<string, string | number>) => (Number(r[c]) > 0 ? fmtCopFull(Number(r[c])) : '—') })),
              { key: '__total', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{fmtCopFull(Number(r.__total) || 0)}</span> },
            ]}
            footer={Object.fromEntries([['month', 'Total'], ['monthKey', '__total'], ...clientKeys.map((c) => [c, data.reduce((s, r) => s + (Number(r[c]) || 0), 0)]), ['__total', data.reduce((s, r) => s + (Number(r.__total) || 0), 0)]]) as Record<string, string | number>}
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 4 }} barGap={2} barCategoryGap="28%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...xAxisProps} />
                <YAxis tickFormatter={fmtCopShort} {...yAxisProps} />
                <Tooltip
                  cursor={hoverCursor}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as Record<string, string | number>;
                    const total = Number(row.__total) || 0;
                    return (
                      <TipBox title={String(label)} titleRight={fmtCopShort(total)} minWidth={230}>
                        {clientKeys.map(k => ({ name: k, value: Number(row[k]) || 0 })).filter(r => r.value > 0).sort((a, b) => b.value - a.value).map(r => (
                          <TipRow key={r.name} color={colorOf(r.name)} label={r.name} value={fmtCopShort(r.value)} sub={`${total > 0 ? ((r.value / total) * 100).toFixed(0) : 0}%`} />
                        ))}
                      </TipBox>
                    );
                  }}
                />
                {clientKeys.map((client, index) => (
                  <Bar key={client} dataKey={client} name={client}
                    stackId={layout === 'stacked' ? 'facturado-clientes' : undefined}
                    fill={colorOf(client)}
                    {...(layout === 'stacked' ? surfaceGap : {})}
                    radius={layout === 'stacked' ? (index === clientKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
                    maxBarSize={layout === 'stacked' ? BAR_MAX : 14}
                    onClick={handleSegmentClick(client)}
                    cursor={client === OTROS ? 'default' : 'pointer'} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <ChartLegend items={clientKeys.map((c) => ({ color: colorOf(c), label: c, shape: 'rect' as const }))} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
