import type { ProductWithMetrics, InventoryMetrics } from '@/hooks/useInventoryData';

interface Props {
  products: ProductWithMetrics[];
  metrics: InventoryMetrics;
}

type Severity = 'amber' | 'blue' | 'green' | 'red';

interface Insight {
  severity: Severity;
  badge: string;
  title: string;
  text: React.ReactNode;
}

const fmtCur = (n: number) =>
  `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

function generateInsights(products: ProductWithMetrics[], metrics: InventoryMetrics): Insight[] {
  const out: Insight[] = [];

  const critical = products.filter(p => p.status === 'critico');
  if (critical.length > 0) {
    const refs = critical.slice(0, 2).map(p => p.reference).join(', ');
    out.push({
      severity: 'amber',
      badge: 'Crítico',
      title: 'Te quedas sin stock pronto',
      text: (
        <>
          {critical.length} referencia{critical.length === 1 ? '' : 's'} con menos de 15 días de cobertura
          {refs && <>: <strong>{refs}</strong></>}. Sugiero generar orden de compra.
        </>
      ),
    });
  }

  const excess = products.filter(p => p.status === 'exceso');
  if (excess.length > 0) {
    const stuckValue = excess.reduce((s, p) => s + p.stock_system * p.cost_per_unit, 0);
    out.push({
      severity: 'blue',
      badge: 'Capital detenido',
      title: `Exceso en ${excess.length} referencia${excess.length === 1 ? '' : 's'}`,
      text: (
        <>
          Tienes <strong>{fmtCur(stuckValue)}</strong> en productos sin rotación. Capital que podrías liberar con promociones.
        </>
      ),
    });
  }

  if (metrics.totalDifference > 0) {
    const withDiff = products.filter(p => p.difference !== 0).length;
    out.push({
      severity: 'green',
      badge: 'Diferencia',
      title: 'Descuadre Siigo vs. físico',
      text: (
        <>
          Se detectaron <strong>{metrics.totalDifference} unidades</strong> de diferencia
          {metrics.totalDifferenceValue > 0 && <> (<strong>{fmtCur(metrics.totalDifferenceValue)}</strong>)</>} en {withDiff} productos. Revisar en el próximo conteo.
        </>
      ),
    });
  }

  if (out.length === 0) {
    out.push({
      severity: 'green',
      badge: 'Todo en orden',
      title: 'Tu inventario está bajo control',
      text: <>Sin alertas por ahora — rotación y stock dentro de rangos saludables.</>,
    });
  }

  return out.slice(0, 3);
}

const STYLES: Record<Severity, {
  bg: string;
  borderLeft: string;
  badgeBg: string;
  badgeColor: string;
}> = {
  amber: {
    bg: 'oklch(0.72 0.15 65 / 0.10)',
    borderLeft: 'oklch(0.72 0.15 65)',
    badgeBg: 'oklch(0.72 0.15 65 / 0.14)',
    badgeColor: 'oklch(0.55 0.15 65)',
  },
  blue: {
    bg: 'oklch(0.52 0.16 240 / 0.08)',
    borderLeft: 'oklch(0.52 0.16 240)',
    badgeBg: 'oklch(0.52 0.16 240 / 0.12)',
    badgeColor: 'oklch(0.52 0.16 240)',
  },
  green: {
    bg: 'oklch(0.43 0.14 155 / 0.10)',
    borderLeft: 'oklch(0.43 0.14 155)',
    badgeBg: 'oklch(0.43 0.14 155 / 0.12)',
    badgeColor: 'oklch(0.43 0.14 155)',
  },
  red: {
    bg: 'oklch(0.52 0.18 25 / 0.08)',
    borderLeft: 'oklch(0.52 0.18 25)',
    badgeBg: 'oklch(0.52 0.18 25 / 0.12)',
    badgeColor: 'oklch(0.52 0.18 25)',
  },
};

export default function InventoryInsights({ products, metrics }: Props) {
  const insights = generateInsights(products, metrics);

  return (
    <div style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.18s both' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'oklch(0.43 0.14 155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            N
          </div>
          Nico analizó tu inventario
          {insights.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                background: 'oklch(0.43 0.14 155 / 0.10)',
                color: 'oklch(0.43 0.14 155)',
                padding: '2px 8px',
                borderRadius: 99,
              }}
            >
              {insights.length} alerta{insights.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {/* Grid of 3 cards */}
      <div
        className={`grid gap-3 grid-cols-1 ${insights.length >= 3 ? 'md:grid-cols-3' : insights.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}
      >
        {insights.map((ins, i) => {
          const s = STYLES[ins.severity];
          return (
            <div
              key={i}
              style={{
                background: s.bg,
                borderRadius: 14,
                padding: 16,
                borderLeft: `3px solid ${s.borderLeft}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                transition: 'box-shadow 0.15s, transform 0.15s',
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.05)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 99,
                  background: s.badgeBg,
                  color: s.badgeColor,
                  marginBottom: 8,
                }}
              >
                {ins.badge}
              </span>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1d1d1f', marginBottom: 4 }}>
                {ins.title}
              </div>
              <div style={{ fontSize: 11.5, color: '#6e6e73', lineHeight: 1.5 }}>
                {ins.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
