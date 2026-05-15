import { DollarSign, Clock, AlertTriangle, ArrowLeftRight, Wallet } from 'lucide-react';
import type { InventoryMetrics as Metrics } from '@/hooks/useInventoryData';

const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const fmtCurrency = (n: number) => `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

interface Props { metrics: Metrics; isGerencial?: boolean; }

type CardDef = {
  key: keyof Metrics;
  label: string;
  hint: string;
  icon: typeof DollarSign;
  format: (n: number) => string;
  gradient: string;
  border: string;
  iconBg: string;
  iconColor: string;
  getBadge: (v: number) => { label: string; bg: string; color: string; border: string } | null;
  /** Si true, este KPI requiere movimientos registrados. Cuando metrics.hasMovementData
   *  es false, mostramos "—" en lugar de un número engañoso. */
  needsMovements?: boolean;
};

const BADGE_AMBER = { bg: 'oklch(0.70 0.17 70 / 0.12)', color: 'oklch(0.55 0.17 70)', border: 'oklch(0.70 0.17 70 / 0.25)' };
const BADGE_RED   = { bg: 'oklch(0.58 0.20 25 / 0.12)', color: 'oklch(0.52 0.18 25)', border: 'oklch(0.58 0.20 25 / 0.25)' };
const BADGE_VIOLET= { bg: 'oklch(0.55 0.17 305 / 0.12)', color: 'oklch(0.50 0.17 305)', border: 'oklch(0.55 0.17 305 / 0.25)' };

// En Gerencial el descuadre se mide contra el teórico (lo que debería haber
// en bodega); en DIAN contra Siigo.
const buildCards = (isGerencial: boolean): CardDef[] => {
const stockLabel = isGerencial ? 'teórico' : 'Siigo';
return [
  {
    key: 'totalValue',
    label: 'Valor Total Inventario',
    hint: `Suma de unidades ${isGerencial ? 'teóricas' : 'Siigo'} × costo unitario de cada producto.`,
    icon: DollarSign,
    format: fmtCurrency,
    gradient: 'linear-gradient(135deg, oklch(0.55 0.15 240 / 0.08), oklch(0.65 0.12 220 / 0.03))',
    border: '1px solid oklch(0.55 0.15 240 / 0.18)',
    iconBg: 'oklch(0.55 0.15 240 / 0.12)',
    iconColor: 'oklch(0.55 0.15 240)',
    getBadge: () => null,
  },
  {
    key: 'avgDaysOfInventory',
    label: 'Días de Inventario',
    hint: 'Días promedio que te dura el stock al ritmo de ventas de los últimos 30 días.',
    icon: Clock,
    format: (n: number) => `${n}d`,
    gradient: 'linear-gradient(135deg, oklch(0.43 0.14 155 / 0.08), oklch(0.55 0.12 165 / 0.03))',
    border: '1px solid oklch(0.43 0.14 155 / 0.22)',
    iconBg: 'oklch(0.43 0.14 155 / 0.12)',
    iconColor: 'oklch(0.43 0.14 155)',
    getBadge: (v: number) =>
      v < 15 ? { label: 'Crítico', ...BADGE_RED }
      : v > 90 ? { label: 'Exceso', ...BADGE_VIOLET }
      : null,
    needsMovements: true,
  },
  {
    key: 'pctNoMovement',
    label: 'Sin Movimiento',
    hint: '% de referencias sin ventas en los últimos 30 días — capital detenido.',
    icon: AlertTriangle,
    format: (n: number) => `${n}%`,
    gradient: 'linear-gradient(135deg, oklch(0.55 0.17 305 / 0.08), oklch(0.60 0.14 295 / 0.03))',
    border: '1px solid oklch(0.55 0.17 305 / 0.18)',
    iconBg: 'oklch(0.55 0.17 305 / 0.12)',
    iconColor: 'oklch(0.55 0.17 305)',
    getBadge: (v: number) => (v > 30 ? { label: 'Alto', ...BADGE_AMBER } : null),
    needsMovements: true,
  },
  {
    key: 'totalDifference',
    label: 'Diferencia Unidades',
    hint: `Unidades de descuadre entre ${stockLabel} y físico (suma de |${stockLabel} − físico|). Señal de fuga o error de registro.`,
    icon: ArrowLeftRight,
    format: fmt,
    gradient: 'linear-gradient(135deg, oklch(0.70 0.17 70 / 0.08), oklch(0.75 0.14 60 / 0.03))',
    border: '1px solid oklch(0.70 0.17 70 / 0.20)',
    iconBg: 'oklch(0.70 0.17 70 / 0.14)',
    iconColor: 'oklch(0.55 0.17 70)',
    getBadge: (v: number) => (v > 0 ? { label: 'Revisar', ...BADGE_AMBER } : null),
  },
  {
    key: 'totalDifferenceValue',
    label: 'Diferencia en Costo',
    hint: `Plata en riesgo: suma de |${stockLabel} − físico| × costo unitario por producto.`,
    icon: Wallet,
    format: fmtCurrency,
    gradient: 'linear-gradient(135deg, oklch(0.62 0.20 15 / 0.08), oklch(0.68 0.17 25 / 0.03))',
    border: '1px solid oklch(0.62 0.20 15 / 0.20)',
    iconBg: 'oklch(0.62 0.20 15 / 0.14)',
    iconColor: 'oklch(0.52 0.18 15)',
    getBadge: (v: number) => (v > 0 ? { label: 'Revisar', ...BADGE_RED } : null),
  },
];
};

export default function InventoryMetrics({ metrics, isGerencial = false }: Props) {
  const cards = buildCards(isGerencial);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((c, idx) => {
        const value = metrics[c.key] as number;
        const showPlaceholder = c.needsMovements && !metrics.hasMovementData;
        const badge = showPlaceholder ? null : c.getBadge(value);
        const Icon = c.icon;
        return (
          <div
            key={c.key}
            style={{
              position: 'relative',
              background: c.gradient,
              border: c.border,
              borderRadius: 14,
              padding: '18px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s',
              animation: `fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) ${idx * 60}ms both`,
              opacity: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
            }}
          >
            {badge && (
              <span
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  padding: '3px 8px',
                  borderRadius: 99,
                  background: badge.bg,
                  color: badge.color,
                  border: `1px solid ${badge.border}`,
                }}
              >
                {badge.label}
              </span>
            )}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: c.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 10,
              }}
            >
              <Icon style={{ width: 15, height: 15, color: c.iconColor }} />
            </div>
            <p
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '-0.6px',
                color: showPlaceholder ? '#a1a1a6' : '#1d1d1f',
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {showPlaceholder ? '—' : c.format(value)}
            </p>
            <p
              style={{
                fontSize: 11.5,
                fontWeight: 550,
                color: '#1d1d1f',
                margin: 0,
                marginTop: 6,
                letterSpacing: '0.1px',
              }}
            >
              {c.label}
            </p>
            <p
              style={{
                fontSize: 10.5,
                color: '#6e6e73',
                margin: 0,
                marginTop: 4,
                lineHeight: 1.4,
              }}
            >
              {showPlaceholder
                ? 'Sin movimientos registrados. Crea remisiones de venta o registra movimientos para calcularlo.'
                : c.hint}
            </p>
          </div>
        );
      })}
    </div>
  );
}
