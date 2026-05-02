import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { InventoryMovement } from '@/hooks/useInventoryData';

interface Props { movements: InventoryMovement[]; }

const BRAND = 'oklch(0.43 0.14 155)';
const DANGER = 'oklch(0.52 0.18 25)';
const AXIS_COLOR = '#a1a1a6';

type Mode = 'daily' | 'weekly' | 'monthly';

function startOfWeekLabel(d: Date): string {
  const monday = new Date(d);
  const day = monday.getDay();
  const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
  monday.setDate(diff);
  return monday.toLocaleDateString('es-CO', { month: 'short', day: 'numeric' });
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
}

export default function InventoryChart({ movements }: Props) {
  const [mode, setMode] = useState<Mode>('daily');

  const chartData = useMemo(() => {
    if (!movements.length) return [];

    const now = new Date();
    // Rango: 30d en daily, 35d en weekly (5 semanas), 90d en monthly (3 meses).
    const rangeDays = mode === 'monthly' ? 90 : mode === 'weekly' ? 35 : 30;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - rangeDays);

    const recent = movements.filter(m => {
      const d = new Date(m.movement_date);
      return d >= cutoff && d <= now;
    });

    const buckets = new Map<string, { label: string; entradas: number; salidas: number; sortKey: string }>();

    if (mode === 'daily') {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        buckets.set(iso, {
          label: d.toLocaleDateString('es-CO', { month: 'short', day: 'numeric' }),
          entradas: 0,
          salidas: 0,
          sortKey: iso,
        });
      }
      recent.forEach(m => {
        const iso = m.movement_date.slice(0, 10);
        const b = buckets.get(iso);
        if (!b) return;
        if (m.movement_type === 'entrada') b.entradas += m.quantity;
        else if (m.movement_type === 'salida') b.salidas += m.quantity;
      });
    } else if (mode === 'weekly') {
      // Weekly buckets (Mon-Sun) — últimas 5 semanas
      for (let i = 4; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        const key = startOfWeekLabel(d);
        if (!buckets.has(key)) {
          buckets.set(key, { label: key, entradas: 0, salidas: 0, sortKey: key });
        }
      }
      recent.forEach(m => {
        const d = new Date(m.movement_date);
        const key = startOfWeekLabel(d);
        const b = buckets.get(key);
        if (!b) return;
        if (m.movement_type === 'entrada') b.entradas += m.quantity;
        else if (m.movement_type === 'salida') b.salidas += m.quantity;
      });
    } else {
      // Monthly buckets — últimos 3 meses
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d);
        buckets.set(key, { label: monthLabel(d), entradas: 0, salidas: 0, sortKey: key });
      }
      recent.forEach(m => {
        const d = new Date(m.movement_date);
        const key = monthKey(d);
        const b = buckets.get(key);
        if (!b) return;
        if (m.movement_type === 'entrada') b.entradas += m.quantity;
        else if (m.movement_type === 'salida') b.salidas += m.quantity;
      });
    }

    return Array.from(buckets.values());
  }, [movements, mode]);

  const hasData = chartData.some(d => d.entradas > 0 || d.salidas > 0);

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.07)',
        borderRadius: 16,
        padding: 18,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 650, color: '#1d1d1f' }}>
            Movimientos de inventario
          </div>
          <div style={{ fontSize: 11.5, color: '#a1a1a6', marginTop: 2 }}>
            Entradas y salidas — {mode === 'monthly' ? 'últimos 3 meses' : mode === 'weekly' ? 'últimas 5 semanas' : 'últimos 30 días'}
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            background: '#f5f5f7',
            borderRadius: 8,
            padding: 2,
            gap: 1,
          }}
        >
          {(['daily', 'weekly', 'monthly'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                border: 'none',
                background: mode === m ? '#fff' : 'transparent',
                boxShadow: mode === m ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 550,
                color: mode === m ? '#1d1d1f' : '#6e6e73',
                cursor: 'pointer',
                borderRadius: 6,
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {m === 'daily' ? 'Diario' : m === 'weekly' ? 'Semanal' : 'Mensual'}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {!hasData ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 160,
            color: '#a1a1a6',
            fontSize: 13,
          }}
        >
          Registra movimientos para ver la evolución
        </div>
      ) : (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="2 3" stroke="rgba(0,0,0,0.07)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: AXIS_COLOR }}
                axisLine={{ stroke: 'rgba(0,0,0,0.07)' }}
                tickLine={false}
                interval={mode === 'daily' ? 4 : 0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: AXIS_COLOR }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                contentStyle={{
                  background: '#fff',
                  border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 10,
                  fontSize: 12,
                  padding: '8px 10px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                }}
                labelStyle={{ color: '#1d1d1f', fontWeight: 600, marginBottom: 4 }}
              />
              <Bar dataKey="entradas" name="Entradas" fill={BRAND} opacity={0.88} radius={[3, 3, 0, 0]} />
              <Bar dataKey="salidas" name="Salidas" fill={DANGER} opacity={0.88} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 10,
          fontSize: 11.5,
          color: '#6e6e73',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: BRAND, display: 'inline-block' }} />
          Entradas
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: DANGER, display: 'inline-block' }} />
          Salidas
        </div>
      </div>
    </div>
  );
}
