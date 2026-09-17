import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Receipt } from 'lucide-react';
import { CHART_COLORS, seriesColor } from '@/lib/chartColors';
import { ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec } from '@/components/dashboard/ChartFilterBar';
import {
  ChartHeader, ChartLegend, ChartDataTable, ChartEmpty, TipBox, TipRow,
  CHART_HEIGHT, BAR_MAX, BAR_RADIUS, gridProps, xAxisProps, yAxisProps, hoverCursor, fmtCopFull, fmtCopShort,
} from './chartKit';

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
  const [invoiceType, setInvoiceType] = useChartFilterParam<InvoiceType>(CHART_ID, 'type', 'venta', ['venta', 'compra', 'both']);
  const [showTable, setShowTable] = useChartFilterBool(CHART_ID, 'table', false);

  const showSales = invoiceType === 'venta' || invoiceType === 'both' || !hasPurchase;
  const showPurchase = hasPurchase && (invoiceType === 'compra' || invoiceType === 'both');

  const merged: MergedRow[] = useMemo(() => {
    const prevMap = new Map((prevYearData ?? []).map(p => [p.monthKey.slice(-2), p]));
    const purchMap = new Map((purchaseData ?? []).map(p => [p.monthKey, p]));
    return data.map(d => {
      const prev = prevMap.get(d.monthKey.slice(-2));
      const purch = purchMap.get(d.monthKey);
      return { ...d, prevTotal: prev?.total ?? null, ticketAvg: d.count > 0 ? d.total / d.count : 0, purchaseTotal: purch?.total ?? 0, purchaseCount: purch?.count ?? 0 };
    });
  }, [data, prevYearData, purchaseData]);

  const yearAvg = useMemo(() => {
    const months = data.filter(d => d.total > 0);
    return months.length === 0 ? 0 : months.reduce((s, d) => s + d.total, 0) / months.length;
  }, [data]);

  // Etiquetas directas SELECTIVAS: el mes pico y el último mes con datos.
  const labeled = useMemo(() => {
    const withData = merged.filter(r => r.total > 0);
    if (withData.length === 0) return new Set<string>();
    const max = withData.reduce((m, r) => (r.total > m.total ? r : m), withData[0]);
    const last = withData[withData.length - 1];
    return new Set([max.monthKey, last.monthKey]);
  }, [merged]);

  const controls: FilterControlSpec[] = [
    ...(hasPurchase ? [{
      kind: 'toggle' as const, id: 'type', label: 'Tipo', value: invoiceType, onChange: setInvoiceType,
      options: [{ value: 'venta' as const, label: 'Venta' }, { value: 'compra' as const, label: 'Compra' }, { value: 'both' as const, label: 'Ambas' }],
    }] : []),
    { kind: 'switch', id: 'yoy', label: `Comparar ${year - 1}`, value: compareYoY && hasPrev, onChange: v => hasPrev && setCompareYoY(v) },
    { kind: 'switch', id: 'table', label: 'Ver como tabla', value: showTable, onChange: setShowTable },
  ];

  const hasData = data.some(p => p.total > 0);
  const handleBarClick = (p: { monthKey?: string }) => { if (p?.monthKey) navigate(`/invoices?month=${p.monthKey}&type=venta`); };

  const seriesCount = (showSales ? 1 : 0) + (showPurchase ? 1 : 0) + (compareYoY && hasPrev ? 1 : 0);
  const legend = [
    ...(showSales ? [{ color: CHART_COLORS.income, label: 'Ventas', shape: 'rect' as const }] : []),
    ...(showPurchase ? [{ color: seriesColor(0), label: 'Compras', shape: 'rect' as const }] : []),
    ...(compareYoY && hasPrev ? [{ color: CHART_COLORS.neutral, label: `${year - 1}`, shape: 'dash' as const }] : []),
    { color: CHART_COLORS.income, label: 'Promedio mensual', shape: 'dash' as const, value: fmtCopShort(yearAvg) },
  ];

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <ChartHeader
        icon={Receipt}
        tone="success"
        title="Total facturado por mes"
        subtitle={`Facturas confirmadas · ${year}${compareYoY && hasPrev ? ` vs ${year - 1}` : ''} · promedio ${fmtCopShort(yearAvg)}/mes`}
        right={<ChartFilterBar chartId={CHART_ID} controls={controls} />}
      />
      <CardContent>
        {!hasData ? (
          <ChartEmpty>Sin facturas confirmadas en {year}</ChartEmpty>
        ) : showTable ? (
          <ChartDataTable
            rows={merged}
            rowKey={(r) => r.monthKey}
            columns={[
              { key: 'm', header: 'Mes', render: (r) => <span className="font-medium text-foreground">{r.month}</span> },
              { key: 't', header: 'Facturado', align: 'right', render: (r) => fmtCopFull(r.total) },
              { key: 'n', header: '# facturas', align: 'right', render: (r) => r.count },
              { key: 'tk', header: 'Ticket prom.', align: 'right', render: (r) => (r.count > 0 ? fmtCopFull(r.ticketAvg) : '—') },
              ...(hasPurchase ? [{ key: 'c', header: 'Compras', align: 'right' as const, render: (r: MergedRow) => fmtCopFull(r.purchaseTotal) }] : []),
              ...(hasPrev ? [{ key: 'p', header: `${year - 1}`, align: 'right' as const, render: (r: MergedRow) => (r.prevTotal == null ? '—' : fmtCopFull(r.prevTotal)) }] : []),
            ]}
            footer={{ month: 'Total', monthKey: '__total', total: merged.reduce((s, r) => s + r.total, 0), count: merged.reduce((s, r) => s + r.count, 0), ticketAvg: 0, prevTotal: hasPrev ? merged.reduce((s, r) => s + (r.prevTotal ?? 0), 0) : null, purchaseTotal: merged.reduce((s, r) => s + r.purchaseTotal, 0), purchaseCount: 0 }}
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart data={merged} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barGap={2} barCategoryGap="28%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...xAxisProps} />
                <YAxis tickFormatter={fmtCopShort} {...yAxisProps} />
                <Tooltip
                  cursor={hoverCursor}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as MergedRow;
                    return (
                      <TipBox title={String(label)}>
                        {showSales && (<>
                          <TipRow color={CHART_COLORS.income} label="Facturado" value={fmtCopFull(row.total)} />
                          <TipRow label="Facturas" value={row.count} muted />
                          <TipRow label="Ticket promedio" value={fmtCopShort(row.ticketAvg)} muted />
                        </>)}
                        {showPurchase && <TipRow color={seriesColor(0)} label="Compras" value={fmtCopFull(row.purchaseTotal)} className="pt-1.5 mt-1 border-t border-border" />}
                        {compareYoY && hasPrev && row.prevTotal !== null && <TipRow color={CHART_COLORS.neutral} label={`${year - 1}`} value={fmtCopShort(row.prevTotal)} className="pt-1.5 mt-1 border-t border-border" />}
                      </TipBox>
                    );
                  }}
                />
                <ReferenceLine y={yearAvg} stroke={CHART_COLORS.income} strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.55} ifOverflow="extendDomain" />
                {showSales && (
                  <Bar dataKey="total" name="Ventas" fill={CHART_COLORS.income} radius={BAR_RADIUS} maxBarSize={BAR_MAX} onClick={handleBarClick} cursor="pointer">
                    <LabelList dataKey="total" position="top" style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontWeight: 600 }}
                      content={(props: { x?: number | string; y?: number | string; width?: number | string; value?: number | string; index?: number }) => {
                        const row = props.index != null ? merged[props.index] : undefined;
                        if (!row || !labeled.has(row.monthKey) || !row.total) return null;
                        const x = Number(props.x) + Number(props.width) / 2;
                        const y = Number(props.y) - 6;
                        return <text x={x} y={y} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--muted-foreground))">{fmtCopShort(row.total)}</text>;
                      }} />
                  </Bar>
                )}
                {showPurchase && <Bar dataKey="purchaseTotal" name="Compras" fill={seriesColor(0)} radius={BAR_RADIUS} maxBarSize={BAR_MAX} />}
                {compareYoY && hasPrev && (
                  <Line type="monotone" dataKey="prevTotal" name={`${year - 1}`} stroke={CHART_COLORS.neutral} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round"
                    dot={{ r: 4, fill: CHART_COLORS.neutral, stroke: 'hsl(var(--card))', strokeWidth: 2 }} activeDot={{ r: 6, stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {seriesCount >= 1 && <ChartLegend items={seriesCount >= 2 ? legend : legend.filter(l => l.shape === 'dash')} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
