export type AgingItem = { pending: number; days_since: number };

type BucketKey = '0-15' | '16-30' | '31-60' | '61-90' | '+90';

interface Props {
  items: AgingItem[];
  selected: BucketKey | 'all';
  onSelect: (bucket: BucketKey | 'all') => void;
  variant?: 'receivable' | 'payable';
}

const BUCKETS: {
  key: BucketKey;
  label: string;
  range: string;
  test: (d: number) => boolean;
  bg: string;
  bgHover: string;
  text: string;
  border: string;
}[] = [
  {
    key: '0-15',
    label: '0–15 días',
    range: 'Al día',
    test: (d) => d <= 15,
    bg: 'oklch(0.55 0.14 155 / 0.08)',
    bgHover: 'oklch(0.55 0.14 155 / 0.14)',
    text: 'oklch(0.43 0.14 155)',
    border: 'oklch(0.55 0.14 155 / 0.22)',
  },
  {
    key: '16-30',
    label: '16–30 días',
    range: 'Pronto a vencer',
    test: (d) => d > 15 && d <= 30,
    bg: 'oklch(0.82 0.15 95 / 0.14)',
    bgHover: 'oklch(0.82 0.15 95 / 0.22)',
    text: 'oklch(0.55 0.15 85)',
    border: 'oklch(0.82 0.15 95 / 0.28)',
  },
  {
    key: '31-60',
    label: '31–60 días',
    range: 'Vencido',
    test: (d) => d > 30 && d <= 60,
    bg: 'oklch(0.70 0.17 55 / 0.12)',
    bgHover: 'oklch(0.70 0.17 55 / 0.20)',
    text: 'oklch(0.55 0.17 55)',
    border: 'oklch(0.70 0.17 55 / 0.28)',
  },
  {
    key: '61-90',
    label: '61–90 días',
    range: 'En riesgo',
    test: (d) => d > 60 && d <= 90,
    bg: 'oklch(0.58 0.20 25 / 0.12)',
    bgHover: 'oklch(0.58 0.20 25 / 0.20)',
    text: 'oklch(0.52 0.18 25)',
    border: 'oklch(0.58 0.20 25 / 0.28)',
  },
  {
    key: '+90',
    label: '+90 días',
    range: 'Crítico',
    test: (d) => d > 90,
    bg: 'oklch(0.40 0.10 25 / 0.12)',
    bgHover: 'oklch(0.40 0.10 25 / 0.20)',
    text: 'oklch(0.35 0.10 25)',
    border: 'oklch(0.40 0.10 25 / 0.28)',
  },
];

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}

export default function AgingBuckets({ items, selected, onSelect }: Props) {
  const stats = BUCKETS.map((b) => {
    const bucketItems = items.filter((i) => b.test(i.days_since));
    const total = bucketItems.reduce((s, i) => s + i.pending, 0);
    return { ...b, count: bucketItems.length, total };
  });

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
      }}
    >
      {stats.map((b, idx) => {
        const isActive = selected === b.key;
        return (
          <button
            key={b.key}
            onClick={() => onSelect(isActive ? 'all' : b.key)}
            style={{
              position: 'relative',
              padding: 18,
              background: isActive ? b.bgHover : b.bg,
              border: `1.5px solid ${isActive ? b.text : b.border}`,
              borderRadius: 14,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.18s cubic-bezier(0.16,1,0.3,1)',
              transform: isActive ? 'translateY(-1px)' : 'none',
              boxShadow: isActive
                ? '0 4px 14px rgba(0,0,0,0.06)'
                : '0 1px 2px rgba(0,0,0,0.03)',
              animation: `fadeUp 0.45s cubic-bezier(0.16,1,0.3,1) ${idx * 55}ms both`,
              opacity: 0,
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = b.bgHover;
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = b.bg;
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  color: b.text,
                }}
              >
                {b.label}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 99,
                  background: '#fff',
                  color: b.text,
                  border: `1px solid ${b.border}`,
                }}
              >
                {b.range}
              </span>
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#1d1d1f',
                letterSpacing: '-0.5px',
                lineHeight: 1.1,
              }}
            >
              {fmtShort(b.total)}
            </div>
            <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 4 }}>
              {b.count} {b.count === 1 ? 'factura' : 'facturas'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
