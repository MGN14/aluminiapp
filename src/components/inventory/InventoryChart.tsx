import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { InventoryMovement } from '@/hooks/useInventoryData';

interface Props { movements: InventoryMovement[]; }

export default function InventoryChart({ movements }: Props) {
  const chartData = useMemo(() => {
    if (!movements.length) return [];

    // Group movements by date, accumulate net stock change
    const byDate = new Map<string, number>();
    const sorted = [...movements].sort((a, b) => a.movement_date.localeCompare(b.movement_date));

    sorted.forEach(m => {
      const d = m.movement_date;
      const current = byDate.get(d) || 0;
      const delta = m.movement_type === 'entrada' ? m.quantity : m.movement_type === 'salida' ? -m.quantity : 0;
      byDate.set(d, current + delta);
    });

    let cumulative = 0;
    return Array.from(byDate.entries()).map(([date, delta]) => {
      cumulative += delta;
      return {
        date: new Date(date).toLocaleDateString('es-CO', { month: 'short', day: 'numeric' }),
        stock: Math.max(0, cumulative),
        raw: date,
      };
    });
  }, [movements]);

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-64 rounded-2xl border border-border/50 bg-muted/20">
        <p className="text-sm text-muted-foreground">Registra movimientos para ver la evolución</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-blue-500/5 to-cyan-500/5 backdrop-blur-sm p-5">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Evolución de inventario</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="inventoryGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152, 69%, 31%)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(152, 69%, 31%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(257, 4.6%, 55.4%)' }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(257, 4.6%, 55.4%)' }} width={40} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(0, 0%, 100%)',
                border: '1px solid hsl(256, 1.3%, 92.9%)',
                borderRadius: '12px',
                fontSize: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
              formatter={(value: number) => [`${value} unidades`, 'Stock']}
            />
            <Area
              type="monotone"
              dataKey="stock"
              stroke="hsl(152, 69%, 31%)"
              strokeWidth={2.5}
              fill="url(#inventoryGlow)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(152, 69%, 31%)', fill: 'white' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
