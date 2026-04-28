import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_COLORS } from '@/lib/chartColors';
import {
  ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec,
} from '@/components/dashboard/ChartFilterBar';

export interface BilledByMonthPoint {
  month: string;
  monthKey: string;
  total: number;
  count: number;
}

interface BilledByMonthChartProps {
  data: BilledByMonthPoint[];
  prevYearData?: BilledByMonthPoint[];
  purchaseData?: BilledByMonthPoint[];
  year: number;
}

type InvoiceType = 'venta' | 'compra' | 'both';

const CHART_ID = 'bil';

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

interface MergedRow extends BilledByMonthPoint {
  prevTotal: number | null;
  ticketAvg: number;
  purchaseTotal: number;
  purchaseCount: number;
}

export function BilledByMonthChart({ data, prevYearData, purchaseData, year }: BilledByMonthChartProps) {
  const navigate = useNavigate();
  const hasPrev = (prevYearData?.length ?? 0) > 0 && prevYearData!.some(p => p.total > 0);
  const hasPurchase = (purchaseData?.length ?? 0) > 0 && purchaseData!.some(p => p.total > 0);

  const [compareYoY, setCompareYoY] = useChartFilterBool(CHART_ID, 'yoy', false);
  const [invoiceType, setInvoiceType] = useChartFilterParam<InvoiceType>(
    CHART_ID, 'type', 'venta', ['venta', 'compra', 'both'],
  );

  const showSales = invoiceType === 'venta' || invoiceType === 'both' || !hasPurchase;
  const showPurchase = hasPurchase && (invoiceType === 'compra' || invoiceType === 'both');

  const merged: MergedRow[] = useMemo(() => {
    const prevMap = new Map((prevYearData ?? []).map(p => [p.monthKey.slice(-2), p]));
    const purchMap = new Map((purchaseData ?? []).map(p => [p.monthKey, p]));
    return data.map(d => {
      const monthIdx = d.monthKey.slice(-2);
      const prev = prevMap.get(monthIdx);
      const purch = purchMap.get(d.monthKey);
      return {
        ...d,
        prevTotal: prev?.total ?? null,
        ticketAvg: d.count > 0 ? d.total / d.count : 0,
        purchaseTotal: purch?.total ?? 0,
        purchaseCount: purch?.count ?? 0,
      };
    });
  }, [data, prevYearData, purchaseData]);

  const yearAvg = useMemo(() => {
    const months = data.filter(d => d.total > 0);
    if (months.length === 0) return 0;
    return months.reduce((s, d) => s + d.total, 0) / months.length;
  }, [data]);

  const controls: FilterControlSpec[] = [
    ...(hasPurchase ? [{
      kind: 'toggle' as const, id: 'type', label: 'Tipo', value: invoiceType, onChange: setInvoiceType,
      options: [
        { value: 'venta' as const, label: 'Venta' },
        { value: 'compra' as const, label: 'Compra' },
        { value: 'both' as const, label: 'Ambas' },
      ],
    }] : []),
    {
      kind: 'switch', id: 'yoy', label: `Comparar ${year - 1}`,
      value: compareYoY && hasPrev,
      onChange: v => hasPrev && setCompareYoY(v),
    },
  ];

  const hasData = data.some(p => p.total > 0);
  if (!hasData) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-lg">Total facturado por mes</CardTitle>
            <p className="text-sm text-muted-foreground">Año {year}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">Sin facturas confirmadas en {year}</div>
        </CardContent>
      </Card>
    );
  }

  const handleBarClick = (p: { monthKey?: string }) => {
    if (!p?.monthKey) return;
    navigate(`/invoices?month=${p.monthKey}&type=venta`);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-lg">Total facturado por mes</CardTitle>
          <p className="text-sm text-muted-foreground truncate">
            Facturas confirmadas • Año {year}{compareYoY && hasPrev && ` vs ${year - 1}`}
          </p>
        </div>
        <ChartFilterBar chartId={CHART_ID} controls={controls} />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={merged} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 11 }} className="text-muted-foreground" axisLine={false} tickLine={false} width={60} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.25 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as MergedRow;
                return (
                  <div className="rounded-lg border bg-card p-3 text-xs shadow-md" style={{ minWidth: 200 }}>
                    <p className="font-semibold text-foreground mb-2">{label}</p>
                    <div className="space-y-1">
                      {showSales && (<>
                        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Facturado</span><span className="font-medium text-foreground tabular-nums">{formatCurrency(row.total)}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground"># facturas</span><span className="tabular-nums">{row.count}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Ticket prom.</span><span className="tabular-nums">{formatCurrencyShort(row.ticketAvg)}</span></div>
                      </>)}
                      {showPurchase && (
                        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border mt-1">
                          <span className="text-muted-foreground">Compras</span>
                          <span className="tabular-nums">{formatCurrency(row.purchaseTotal)}</span>
                        </div>
                      )}
                      {compareYoY && hasPrev && row.prevTotal !== null && (
                        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border mt-1">
                          <span className="text-muted-foreground">{year - 1}</span>
                          <span className="tabular-nums">{formatCurrencyShort(row.prevTotal)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={yearAvg} stroke={CHART_COLORS.incomeAvg} strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.65} ifOverflow="extendDomain"
              label={{ value: `Prom. ${formatCurrencyShort(yearAvg)}`, position: 'right', fill: CHART_COLORS.income, fontSize: 10 }} />
            {showSales && (
              <Bar dataKey="total" name="Venta" fill={CHART_COLORS.income} radius={[4, 4, 0, 0]} maxBarSize={48} onClick={handleBarClick} cursor="pointer" />
            )}
            {showPurchase && (
              <Bar dataKey="purchaseTotal" name="Compra" fill="oklch(0.55 0.12 250)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            )}
            {compareYoY && hasPrev && (
              <Line type="monotone" dataKey="prevTotal" name={`${year - 1}`} stroke="hsl(220, 9%, 46%)" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 2.5, fill: 'hsl(220, 9%, 46%)', strokeWidth: 0 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
