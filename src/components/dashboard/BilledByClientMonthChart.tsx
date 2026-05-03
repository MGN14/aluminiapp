import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { INVOICE_SERIES_COLORS } from '@/lib/chartColors';
import { parseLocalDate } from '@/lib/dateUtils';
import { MONTH_NAMES } from '@/types/transaction';
import { useCounterpartyResolver, resolveCounterpartyName } from '@/lib/counterpartyResolver';
import {
  ChartFilterBar, useChartFilterParam, type FilterControlSpec,
} from '@/components/dashboard/ChartFilterBar';

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

type TopN = '3' | '5' | '10';
type Layout = 'stacked' | 'grouped';

const CHART_ID = 'cli';

function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function BilledByClientMonthChart({ salesInvoices, year }: BilledByClientMonthChartProps) {
  const navigate = useNavigate();
  const [topN, setTopN] = useChartFilterParam<TopN>(CHART_ID, 'topN', '5', ['3', '5', '10']);
  const [layout, setLayout] = useChartFilterParam<Layout>(CHART_ID, 'layout', 'stacked', ['stacked', 'grouped']);
  const counterpartyResolver = useCounterpartyResolver();

  const { data, clientKeys } = useMemo(() => {
    const n = Number(topN);
    const nameOf = (inv: SalesInvoiceLite) =>
      resolveCounterpartyName(inv.counterparty_name, inv.responsible_id, counterpartyResolver);
    const totalsByClient = new Map<string, number>();
    salesInvoices.forEach(inv => {
      const c = nameOf(inv);
      totalsByClient.set(c, (totalsByClient.get(c) || 0) + (inv.total_amount || 0));
    });
    const topClients = Array.from(totalsByClient.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name);
    const rows = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, string | number> = {
        month: MONTH_NAMES[i].slice(0, 3),
        monthKey: `${year}-${String(i + 1).padStart(2, '0')}`,
        __total: 0,
      };
      topClients.forEach(c => { row[c] = 0; });
      row.Otros = 0;
      return row;
    });
    let hasOthers = false;
    salesInvoices.forEach(inv => {
      const mi = parseLocalDate(inv.issue_date).getMonth();
      if (mi < 0 || mi > 11) return;
      const c = nameOf(inv);
      const isTop = topClients.includes(c);
      const key = isTop ? c : 'Otros';
      if (!isTop) hasOthers = true;
      const amount = inv.total_amount || 0;
      rows[mi][key] = (Number(rows[mi][key]) || 0) + amount;
      rows[mi].__total = (Number(rows[mi].__total) || 0) + amount;
    });
    return { data: rows, clientKeys: hasOthers ? [...topClients, 'Otros'] : topClients };
  }, [salesInvoices, topN, year, counterpartyResolver]);

  const controls: FilterControlSpec[] = [
    {
      kind: 'select', id: 'topN', label: 'Top', value: topN, onChange: setTopN, width: 110,
      options: [
        { value: '3', label: 'Top 3' }, { value: '5', label: 'Top 5' }, { value: '10', label: 'Top 10' },
      ],
    },
    {
      kind: 'toggle', id: 'layout', label: 'Vista', value: layout, onChange: setLayout,
      options: [{ value: 'stacked', label: 'Stacked' }, { value: 'grouped', label: 'Lado a lado' }],
    },
  ];

  if (clientKeys.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-lg">Facturado por cliente por mes</CardTitle>
            <p className="text-sm text-muted-foreground">Año {year}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">Sin clientes facturados en {year}</div>
        </CardContent>
      </Card>
    );
  }

  const handleSegmentClick = (clientName: string) => (p: { monthKey?: string }) => {
    if (!p?.monthKey || clientName === 'Otros') return;
    const params = new URLSearchParams({ month: p.monthKey, counterparty: clientName, type: 'venta' });
    navigate(`/invoices?${params.toString()}`);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg">Facturado por cliente por mes</CardTitle>
          <p className="text-sm text-muted-foreground truncate">Top {topN} clientes • Año {year}</p>
        </div>
        <ChartFilterBar chartId={CHART_ID} controls={controls} />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={60} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.25 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, string | number>;
                const total = Number(row.__total) || 0;
                return (
                  <div className="rounded-lg border bg-card p-3 text-xs shadow-md" style={{ minWidth: 220 }}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="font-semibold text-foreground">{label}</p>
                      <span className="text-muted-foreground tabular-nums">{formatCurrencyShort(total)}</span>
                    </div>
                    <div className="space-y-1">
                      {clientKeys.map(k => ({ name: k, value: Number(row[k]) || 0 }))
                        .filter(r => r.value > 0).sort((a, b) => b.value - a.value).map(r => {
                          const pct = total > 0 ? (r.value / total) * 100 : 0;
                          return (
                            <div key={r.name} className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-1.5 truncate">
                                <span className="h-2 w-2 rounded-sm shrink-0" style={{
                                  background: r.name === 'Otros' ? 'hsl(220, 9%, 70%)'
                                    : INVOICE_SERIES_COLORS[clientKeys.indexOf(r.name) % INVOICE_SERIES_COLORS.length],
                                }} />
                                <span className="truncate max-w-[120px]">{r.name}</span>
                              </span>
                              <span className="flex items-center gap-2 tabular-nums">
                                <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                                <span className="font-medium">{formatCurrencyShort(r.value)}</span>
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              }}
            />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
            {clientKeys.map((client, index) => (
              <Bar key={client} dataKey={client} name={client}
                stackId={layout === 'stacked' ? 'facturado-clientes' : undefined}
                fill={client === 'Otros' ? 'hsl(220, 9%, 70%)' : INVOICE_SERIES_COLORS[index % INVOICE_SERIES_COLORS.length]}
                radius={layout === 'stacked' ? (index === clientKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
                maxBarSize={layout === 'stacked' ? 48 : 16}
                onClick={handleSegmentClick(client)}
                cursor={client === 'Otros' ? 'default' : 'pointer'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
