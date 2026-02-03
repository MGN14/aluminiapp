import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCategoryColor } from '@/lib/chartColors';

interface CategoryData {
  category: string;
  categoryKey: string;
  value: number;
}

interface ExpensesByCategoryChartProps {
  data: CategoryData[];
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

export function ExpensesByCategoryChart({ data, periodLabel }: ExpensesByCategoryChartProps) {
  // Sort by value descending for better visualization
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => b.value - a.value);
  }, [data]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Egresos por Categoría</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            Sin egresos categorizados
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">¿En qué se va la plata?</CardTitle>
        <p className="text-sm text-muted-foreground">Egresos por categoría • {periodLabel}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart 
            data={sortedData} 
            layout="horizontal"
            margin={{ top: 10, right: 20, left: 0, bottom: 20 }}
            barCategoryGap="20%"
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              vertical={false}
              className="stroke-border" 
            />
            <XAxis 
              type="category" 
              dataKey="category" 
              tick={{ fontSize: 11 }} 
              className="text-muted-foreground"
              axisLine={false}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              height={60}
              interval={0}
            />
            <YAxis 
              type="number"
              tickFormatter={formatCurrencyShort} 
              tick={{ fontSize: 11 }} 
              className="text-muted-foreground"
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip 
              formatter={(value: number) => [formatCurrency(value), 'Monto']}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-md)',
              }}
              cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.3 }}
            />
            <Bar 
              dataKey="value" 
              name="Monto"
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            >
              {sortedData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={getCategoryColor(entry.categoryKey)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        
        {/* Legend with category colors */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          {sortedData.slice(0, 5).map((entry, index) => (
            <div key={index} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div 
                className="w-3 h-3 rounded-sm shrink-0" 
                style={{ backgroundColor: getCategoryColor(entry.categoryKey) }}
              />
              <span>{entry.category}</span>
            </div>
          ))}
          {sortedData.length > 5 && (
            <span className="text-xs text-muted-foreground">+{sortedData.length - 5} más</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
