import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_COLORS } from '@/lib/chartColors';

interface MonthlyData {
  month: string;
  monthKey: string;
  ingresos: number;
  egresos: number;
}

interface IncomeVsExpenseChartProps {
  data: MonthlyData[];
  periodLabel: string;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export function IncomeVsExpenseChart({ data, periodLabel }: IncomeVsExpenseChartProps) {
  // Calculate averages
  const averages = useMemo(() => {
    if (data.length === 0) return { ingresos: 0, egresos: 0 };
    
    const totalIngresos = data.reduce((sum, d) => sum + d.ingresos, 0);
    const totalEgresos = data.reduce((sum, d) => sum + d.egresos, 0);
    
    return {
      ingresos: totalIngresos / data.length,
      egresos: totalEgresos / data.length,
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ingresos vs Egresos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            Sin datos para graficar
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Ingresos vs Egresos</CardTitle>
        <p className="text-sm text-muted-foreground">Comparación mes a mes • {periodLabel}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart 
            data={data} 
            margin={{ top: 20, right: 20, left: 0, bottom: 5 }}
            barCategoryGap="15%"
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              vertical={false}
              className="stroke-border" 
            />
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
              formatter={(value: number, name: string) => [
                formatCurrency(value),
                name === 'ingresos' ? 'Ingresos' : 'Egresos'
              ]}
              labelFormatter={label => `Periodo: ${label}`}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-md)',
              }}
            />
            <Legend 
              formatter={(value) => value === 'ingresos' ? 'Ingresos' : 'Egresos'}
              iconType="square"
            />
            
            {/* Average reference lines - subtle, behind bars */}
            <ReferenceLine 
              y={averages.ingresos} 
              stroke={CHART_COLORS.incomeAvg}
              strokeDasharray="6 4"
              strokeWidth={1.5}
              strokeOpacity={0.7}
              label={{
                value: `Prom: ${formatCurrencyShort(averages.ingresos)}`,
                position: 'right',
                fill: CHART_COLORS.income,
                fontSize: 10,
              }}
            />
            <ReferenceLine 
              y={averages.egresos} 
              stroke={CHART_COLORS.expenseAvg}
              strokeDasharray="6 4"
              strokeWidth={1.5}
              strokeOpacity={0.7}
              label={{
                value: `Prom: ${formatCurrencyShort(averages.egresos)}`,
                position: 'right',
                fill: CHART_COLORS.expense,
                fontSize: 10,
              }}
            />
            
            {/* Stacked bars - income and expense side by side */}
            <Bar 
              dataKey="ingresos" 
              name="ingresos"
              fill={CHART_COLORS.income}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
            <Bar 
              dataKey="egresos" 
              name="egresos"
              fill={CHART_COLORS.expense}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
        
        {/* Legend explanation */}
        <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-8 h-[2px] border-t-2 border-dashed" style={{ borderColor: CHART_COLORS.incomeAvg }} />
            <span>Promedio Ingresos</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-8 h-[2px] border-t-2 border-dashed" style={{ borderColor: CHART_COLORS.expenseAvg }} />
            <span>Promedio Egresos</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
