import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { INVOICE_SERIES_COLORS } from '@/lib/chartColors';

type ClientMonthPoint = Record<string, string | number>;

interface BilledByClientMonthChartProps {
  data: ClientMonthPoint[];
  clientKeys: string[];
  year: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function BilledByClientMonthChart({ data, clientKeys, year }: BilledByClientMonthChartProps) {
  if (clientKeys.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Facturado por cliente por mes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            Sin clientes facturados en {year}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Facturado por cliente por mes</CardTitle>
        <p className="text-sm text-muted-foreground">Top clientes en facturas confirmadas • Año {year}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatCurrencyShort}
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip
              formatter={(value: number, name: string) => [formatCurrency(value), name]}
              labelFormatter={(label) => `Mes: ${label}`}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-md)',
              }}
            />
            <Legend iconType="square" />

            {clientKeys.map((client, index) => (
              <Bar
                key={client}
                dataKey={client}
                name={client}
                stackId="facturado-clientes"
                fill={INVOICE_SERIES_COLORS[index % INVOICE_SERIES_COLORS.length]}
                radius={index === clientKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
