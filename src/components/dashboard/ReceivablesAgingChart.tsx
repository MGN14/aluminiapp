import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { HandCoins } from 'lucide-react';
import { useCollectionData } from '@/hooks/useCollectionData';
import { ORDINAL_RAMP } from '@/lib/chartColors';
import type { ClientAging } from '@/lib/agingBuckets';
import { ChartFilterBar, useChartFilterBool, useChartFilterParam, type FilterControlSpec } from '@/components/dashboard/ChartFilterBar';
import { DashLoading } from './cardKit';
import {
  ChartHeader, ChartLegend, ChartDataTable, ChartEmpty, TipBox, TipRow,
  CHART_HEIGHT, gridProps, tickStyle, hoverCursor, surfaceGap, fmtCopFull, fmtCopShort, endLabel,
} from './chartKit';

/**
 * Cartera por edades: lo que te deben, por cuánto lleva vencido y de quién.
 * Barras horizontales apiladas por cliente (más deuda arriba), 5 bandas en
 * una sola tonalidad de claro a oscuro (escala ORDINAL: más viejo = más
 * oscuro). Misma fuente que Lo que me deben: useCollectionData → aging
 * (Σ bandas = saldo neto por cliente).
 */

type TopN = '5' | '8' | '12';
const CHART_ID = 'aging';
const OTROS = 'Otros clientes';

const BUCKETS = [
  { key: 'corriente', label: 'Al día' },
  { key: 'd1_30', label: '1-30 días' },
  { key: 'd31_60', label: '31-60' },
  { key: 'd61_90', label: '61-90' },
  { key: 'd90_plus', label: '+90 días' },
] as const;
type BucketKey = typeof BUCKETS[number]['key'];

interface Row {
  name: string;
  responsible_id: string | null;
  corriente: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number;
  total: number;
  oldest: number;
}

export function ReceivablesAgingChart({ year }: { year: number }) {
  const navigate = useNavigate();
  const { data, isLoading } = useCollectionData(year);
  const [topN, setTopN] = useChartFilterParam<TopN>(CHART_ID, 'topN', '8', ['5', '8', '12']);
  const [showTable, setShowTable] = useChartFilterBool(CHART_ID, 'table', false);

  const { rows, totals } = useMemo(() => {
    const clients = (data?.aging.clients ?? []).filter((c) => c.buckets.total > 0.5);
    const toRow = (c: ClientAging): Row => ({
      name: c.client_name, responsible_id: c.responsible_id,
      corriente: c.buckets.corriente, d1_30: c.buckets.d1_30, d31_60: c.buckets.d31_60, d61_90: c.buckets.d61_90, d90_plus: c.buckets.d90_plus,
      total: c.buckets.total, oldest: c.oldest_overdue_days,
    });
    const sorted = [...clients].sort((a, b) => b.buckets.total - a.buckets.total).map(toRow);
    const n = Number(topN);
    let rows = sorted;
    if (sorted.length > n) {
      const head = sorted.slice(0, n);
      const tail = sorted.slice(n);
      const otros: Row = tail.reduce((acc, r) => ({
        ...acc, corriente: acc.corriente + r.corriente, d1_30: acc.d1_30 + r.d1_30, d31_60: acc.d31_60 + r.d31_60, d61_90: acc.d61_90 + r.d61_90, d90_plus: acc.d90_plus + r.d90_plus,
        total: acc.total + r.total, oldest: Math.max(acc.oldest, r.oldest),
      }), { name: `${OTROS} (${tail.length})`, responsible_id: null, corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, oldest: 0 });
      rows = [...head, otros];
    }
    return { rows, totals: data?.aging.totals ?? null };
  }, [data, topN]);

  const controls: FilterControlSpec[] = [
    { kind: 'select', id: 'topN', label: 'Clientes', value: topN, onChange: setTopN, width: 120,
      options: [{ value: '5', label: 'Top 5' }, { value: '8', label: 'Top 8' }, { value: '12', label: 'Top 12' }] },
    { kind: 'switch', id: 'table', label: 'Ver como tabla', value: showTable, onChange: setShowTable },
  ];

  if (isLoading) return <DashLoading lines={4} />;

  const total = totals?.total ?? 0;
  const vencido = total > 0 ? total - (totals?.corriente ?? 0) : 0;
  const pctVencido = total > 0 ? (vencido / total) * 100 : 0;
  const tone = pctVencido >= 50 ? 'alarm' : pctVencido >= 20 ? 'warn' : 'success';
  const height = Math.max(CHART_HEIGHT, rows.length * 36 + 24);

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <ChartHeader
        icon={HandCoins}
        tone={tone}
        title="Cartera por edades"
        subtitle={total > 0
          ? `Te deben ${fmtCopShort(total)} · ${pctVencido.toFixed(0)}% ya vencido (${fmtCopShort(vencido)}) · ${year}`
          : `Sin cartera pendiente · ${year}`}
        right={<ChartFilterBar chartId={CHART_ID} controls={controls} />}
      />
      <CardContent>
        {rows.length === 0 ? (
          <ChartEmpty>Nadie te debe plata en {year}. 🎉</ChartEmpty>
        ) : showTable ? (
          <ChartDataTable
            rows={rows}
            rowKey={(r) => r.name}
            columns={[
              { key: 'c', header: 'Cliente', render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
              ...BUCKETS.map((b) => ({ key: b.key, header: b.label, align: 'right' as const, render: (r: Row) => (r[b.key] > 0 ? fmtCopFull(r[b.key]) : '—') })),
              { key: 't', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{fmtCopFull(r.total)}</span> },
              { key: 'o', header: 'Máx. vencido', align: 'right', render: (r) => (r.oldest > 0 ? `${r.oldest} d` : 'al día') },
            ]}
            footer={totals ? { name: 'Total', responsible_id: null, corriente: totals.corriente, d1_30: totals.d1_30, d31_60: totals.d31_60, d61_90: totals.d61_90, d90_plus: totals.d90_plus, total: totals.total, oldest: 0 } : undefined}
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 84, left: 8, bottom: 4 }} barCategoryGap="30%">
                <CartesianGrid stroke={gridProps.stroke} strokeWidth={1} horizontal={false} />
                <XAxis type="number" tickFormatter={fmtCopShort} tick={tickStyle} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ ...tickStyle, fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} width={150} />
                <Tooltip
                  cursor={hoverCursor}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const r = payload[0].payload as Row;
                    return (
                      <TipBox title={r.name} titleRight={fmtCopShort(r.total)} minWidth={230}>
                        {BUCKETS.map((b, i) => r[b.key] > 0 && (
                          <TipRow key={b.key} color={ORDINAL_RAMP[i]} label={b.label} value={fmtCopFull(r[b.key])} sub={`${((r[b.key] / r.total) * 100).toFixed(0)}%`} />
                        ))}
                        {r.oldest > 0 && <TipRow label="Factura más vieja" value={`${r.oldest} días vencida`} muted className="pt-1.5 mt-1 border-t border-border" />}
                      </TipBox>
                    );
                  }}
                />
                {BUCKETS.map((b, i) => (
                  <Bar key={b.key} dataKey={b.key} name={b.label} stackId="aging" fill={ORDINAL_RAMP[i]} {...surfaceGap}
                    radius={i === BUCKETS.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]} maxBarSize={22}
                    onClick={(p: { responsible_id?: string | null }) => { if (p?.responsible_id) navigate(`/terceros/${p.responsible_id}`); }}
                    cursor="pointer">
                    {i === BUCKETS.length - 1 && (
                      <LabelList dataKey="total" content={endLabel((i) => (rows[i] ? fmtCopShort(rows[i].total) : null))} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
            <ChartLegend items={BUCKETS.map((b, i) => ({ color: ORDINAL_RAMP[i], label: b.label, shape: 'rect' as const, value: totals && totals[b.key as BucketKey] > 0 ? fmtCopShort(totals[b.key as BucketKey]) : undefined }))} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
