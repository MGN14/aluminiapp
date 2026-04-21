import { DollarSign, Clock, RefreshCw, AlertTriangle, ArrowLeftRight } from 'lucide-react';
import type { InventoryMetrics as Metrics } from '@/hooks/useInventoryData';

const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const fmtCurrency = (n: number) => `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

interface Props { metrics: Metrics; }

const cards = [
  {
    key: 'totalValue',
    label: 'Valor Total Inventario',
    hint: 'Suma de unidades Siigo × costo unitario de cada producto.',
    icon: DollarSign,
    format: fmtCurrency,
    color: 'from-blue-500/20 to-cyan-500/10',
    iconColor: 'text-blue-400',
    getBadge: () => null,
  },
  {
    key: 'avgDaysOfInventory',
    label: 'Días de Inventario',
    hint: 'Días promedio que te dura el stock al ritmo de ventas de los últimos 30 días.',
    icon: Clock,
    format: (n: number) => `${n}d`,
    color: 'from-emerald-500/20 to-green-500/10',
    iconColor: 'text-emerald-400',
    getBadge: (v: number) => v < 15 ? 'Crítico' : v > 90 ? 'Exceso' : null,
  },
  {
    key: 'avgRotation',
    label: 'Rotación Promedio',
    hint: 'Cuántas veces roto tu inventario al mes. Más alto = más dinámico.',
    icon: RefreshCw,
    format: (n: number) => `${n}x`,
    color: 'from-violet-500/20 to-purple-500/10',
    iconColor: 'text-violet-400',
    getBadge: () => null,
  },
  {
    key: 'pctNoMovement',
    label: 'Sin Movimiento',
    hint: '% de referencias sin ventas en los últimos 30 días — capital detenido.',
    icon: AlertTriangle,
    format: (n: number) => `${n}%`,
    color: 'from-amber-500/20 to-orange-500/10',
    iconColor: 'text-amber-400',
    getBadge: (v: number) => v > 30 ? 'Alto' : null,
  },
  {
    key: 'totalDifference',
    label: 'Diferencia Inventario',
    hint: 'Unidades de descuadre entre Siigo y físico (suma de |Siigo − físico|). Señal de fuga o error de registro.',
    icon: ArrowLeftRight,
    format: fmt,
    color: 'from-rose-500/20 to-pink-500/10',
    iconColor: 'text-rose-400',
    getBadge: (v: number) => v > 0 ? 'Revisar' : null,
  },
] as const;

export default function InventoryMetrics({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map(c => {
        const value = metrics[c.key as keyof Metrics] as number;
        const badge = c.getBadge(value);
        return (
          <div
            key={c.key}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${c.color} backdrop-blur-sm border border-white/[0.06] p-5 transition-all hover:scale-[1.02] hover:shadow-lg`}
          >
            {badge && (
              <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-warning/20 text-warning border border-warning/30">
                {badge}
              </span>
            )}
            <c.icon className={`h-5 w-5 ${c.iconColor} mb-3 opacity-80`} />
            <p className="text-3xl font-bold tracking-tight text-foreground">{c.format(value)}</p>
            <p className="text-xs font-medium text-foreground/80 mt-1">{c.label}</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{c.hint}</p>
          </div>
        );
      })}
    </div>
  );
}
