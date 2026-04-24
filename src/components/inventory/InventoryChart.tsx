import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { InventoryMovement } from '@/hooks/useInventoryData';

interface Props { movements: InventoryMovement[]; }

const BRAND = 'oklch(0.43 0.14 155)';
const AXIS_COLOR = '#a1a1a6';

export default function InventoryChart({ movements }: Props) {
  const chartData = useMemo(() => {
    if (!movements.length) return [];

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 256,
          borderRadius: 18,
          border: '1.5px solid rgba(0,0,0,0.07)',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <p style={{ fontSize: 13, color: '#6e6e73', margin: 0 }}>
          Registra movimientos para ver la evolución
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(135deg, oklch(0.43 0.14 155 / 0.04), oklch(0.55 0.12 165 / 0.01))',
        border: '1.5px solid rgba(0,0,0,0.07)',
        borderRadius: 18,
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#1d1d1f',
          margin: 0,
          marginBottom: 16,
          letterSpacing: '-0.1px',
        }}
      >
        Evolución de inventario
      </h3>
      <div style={{ height: 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="inventoryGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: AXIS_COLOR }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: AXIS_COLOR }}
              width={40}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid rgba(0,0,0,0.07)',
                borderRadius: 12,
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                padding: '8px 12px',
              }}
              labelStyle={{ color: '#6e6e73', fontSize: 11, marginBottom: 2 }}
              itemStyle={{ color: '#1d1d1f', fontWeight: 600 }}
              formatter={(value: number) => [`${value} unidades`, 'Stock']}
            />
            <Area
              type="monotone"
              dataKey="stock"
              stroke={BRAND}
              strokeWidth={2.5}
              fill="url(#inventoryGlow)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: BRAND, fill: '#fff' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
