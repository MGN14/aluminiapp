import { Sparkles, AlertTriangle, TrendingUp, TrendingDown, Activity } from 'lucide-react';

const obligaciones = [
  { label: 'Nómina', sub: 'Media Nómina', days: '10d', amount: '$2 M' },
  { label: 'PILA', sub: 'MiPlanilla', days: '10d', amount: '$3 M' },
  { label: 'IVA', sub: 'Cuatrimestral', days: '20d', amount: '—' },
  { label: 'Retefuente', sub: 'Abril', days: '20d', amount: '—' },
];

const macros = [
  { label: 'Dólar', sub: 'TRM Oficial', value: '$3.707', change: '+1.93%', positive: true },
  { label: 'Crédito', sub: 'DTF · BanRep', value: '11.25%', change: '0.00pp', positive: null },
  { label: 'Inflación', sub: 'IPC anual', value: '6.61%', change: '0.00pp', positive: null },
  { label: 'Aluminio', sub: 'LME · USD/T', value: 'US$3.524', change: '+2.39%', positive: true },
];

// 7-point trend datasets (normalized 0-100) → drives sparkline path
const ingresosTrend = [22, 30, 28, 45, 52, 48, 65];
const resultadoTrend = [60, 50, 48, 35, 28, 25, 18];
const scoreTrend = [55, 58, 62, 60, 65, 70, 72];

function Sparkline({ values, color, fill }: { values: number[]; color: string; fill: string }) {
  const w = 100;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  const areaPath = `M0,${h} L${points.split(' ').join(' L')} L${w},${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 24, display: 'block' }}
    >
      <path d={areaPath} fill={fill} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function HeroDashboardMockup() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 580,
        margin: '0 auto',
        position: 'relative',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      {/* Browser frame */}
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow:
            '0 20px 60px -12px rgba(0,0,0,0.5), 0 8px 24px -8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Browser top bar */}
        <div
          style={{
            background: '#f3f4f6',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
          </div>
          <div
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              color: '#6b7280',
              border: '1px solid rgba(0,0,0,0.05)',
              marginLeft: 8,
              textAlign: 'center',
              fontFamily: '-apple-system, monospace',
            }}
          >
            aluminiapp.com/dashboard
          </div>
        </div>

        {/* Mercados en vivo (header oscuro) */}
        <div style={{ background: '#080d08', padding: '14px 16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 9,
                fontWeight: 700,
                color: 'oklch(0.75 0.18 155)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              <span
                className="animate-pulse"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'oklch(0.75 0.18 155)',
                }}
              />
              Mercados · En vivo
            </div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em' }}>
              SINCRONIZADO HOY
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {macros.map((m) => (
              <div key={m.label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>
                  {m.sub}
                </div>
                <div style={{ fontSize: 11, color: '#fff', fontWeight: 700, lineHeight: 1.1 }}>
                  {m.value}
                </div>
                <div
                  style={{
                    fontSize: 8,
                    color:
                      m.positive === true
                        ? 'oklch(0.75 0.18 155)'
                        : m.positive === false
                        ? '#f87171'
                        : 'rgba(255,255,255,0.4)',
                    marginTop: 1,
                  }}
                >
                  {m.change}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard content */}
        <div style={{ padding: '18px', background: '#fafafa' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'oklch(0.43 0.14 155 / 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles style={{ width: 16, height: 16, color: 'oklch(0.43 0.14 155)' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>
                Tu negocio hoy
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>2026 · 20 patrones analizados</div>
            </div>
          </div>

          {/* Score + badge row */}
          <div
            style={{
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              borderLeft: '3px solid #f59e0b',
            }}
          >
            <div style={{ position: 'relative', width: 50, height: 50, flexShrink: 0 }}>
              <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="25" cy="25" r="21" fill="none" stroke="#f3f4f6" strokeWidth="5" />
                <circle
                  cx="25"
                  cy="25"
                  r="21"
                  fill="none"
                  stroke="oklch(0.43 0.14 155)"
                  strokeWidth="5"
                  strokeDasharray={`${(72 / 100) * 132} 132`}
                  strokeLinecap="round"
                />
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  fontWeight: 700,
                }}
              >
                <span style={{ fontSize: 14, color: '#111827', lineHeight: 1 }}>72</span>
                <span style={{ fontSize: 7, color: '#6b7280' }}>/100</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  color: '#92400e',
                  background: '#fef3c7',
                  padding: '2px 8px',
                  borderRadius: 99,
                  fontWeight: 600,
                  marginBottom: 3,
                }}
              >
                <AlertTriangle style={{ width: 10, height: 10 }} />
                Ojo, viene la DIAN
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
                Hay problemas, pero puedes mejorar
              </div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
                Punto débil: Control de Inventario
              </div>
            </div>
          </div>

          {/* KPIs row con sparklines */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 6,
              marginBottom: 12,
            }}
          >
            {/* Ingresos */}
            <div
              style={{
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 10,
                padding: '10px',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 8,
                  color: '#6b7280',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                <TrendingUp style={{ width: 9, height: 9, color: 'oklch(0.43 0.14 155)' }} />
                Ingresos
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'oklch(0.43 0.14 155)',
                  lineHeight: 1.1,
                  marginBottom: 4,
                }}
              >
                $ 801,7M
              </div>
              <Sparkline
                values={ingresosTrend}
                color="oklch(0.43 0.14 155)"
                fill="oklch(0.43 0.14 155 / 0.12)"
              />
            </div>
            {/* Resultado neto */}
            <div
              style={{
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 10,
                padding: '10px',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 8,
                  color: '#6b7280',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                <TrendingDown style={{ width: 9, height: 9, color: '#dc2626' }} />
                Result. neto
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#dc2626',
                  lineHeight: 1.1,
                  marginBottom: 4,
                }}
              >
                -$ 92,8M
              </div>
              <Sparkline values={resultadoTrend} color="#dc2626" fill="rgba(220,38,38,0.1)" />
            </div>
            {/* Score */}
            <div
              style={{
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 10,
                padding: '10px',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 8,
                  color: '#6b7280',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                <Activity style={{ width: 9, height: 9, color: '#f59e0b' }} />
                Score DIAN
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#111827',
                  lineHeight: 1.1,
                  marginBottom: 4,
                }}
              >
                72 <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 500 }}>/100</span>
              </div>
              <Sparkline values={scoreTrend} color="#f59e0b" fill="rgba(245,158,11,0.12)" />
            </div>
          </div>

          {/* Próximas obligaciones */}
          <div
            style={{
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                fontSize: 10,
                fontWeight: 600,
                color: '#374151',
                borderBottom: '1px solid rgba(0,0,0,0.04)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>📅 Próximas obligaciones</span>
              <span style={{ color: '#9ca3af', fontWeight: 400 }}>45d</span>
            </div>
            {obligaciones.map((o, i) => (
              <div
                key={o.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '14px 60px 1fr 30px 50px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  fontSize: 10,
                  borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.03)',
                }}
              >
                <input
                  type="checkbox"
                  readOnly
                  style={{ width: 12, height: 12, accentColor: 'oklch(0.43 0.14 155)' }}
                />
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#374151',
                    background: '#f3f4f6',
                    padding: '2px 6px',
                    borderRadius: 4,
                    textAlign: 'center',
                  }}
                >
                  {o.label}
                </span>
                <span style={{ color: '#6b7280', fontSize: 10 }}>{o.sub}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: '#92400e' }}>{o.days}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#374151', textAlign: 'right' }}>
                  {o.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connector line del mockup al chat */}
      <div
        aria-hidden
        style={{
          width: 2,
          height: 20,
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0))',
          margin: '0 auto',
        }}
      />

      {/* Nico mini-chat — despegable bajo el mockup */}
      <div
        style={{
          marginTop: 0,
          marginRight: 'auto',
          marginLeft: 'auto',
          background: '#fff',
          borderRadius: 16,
          padding: '14px 16px',
          boxShadow:
            '0 16px 40px -8px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.04)',
          maxWidth: 460,
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'oklch(0.43 0.14 155 / 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 14,
            }}
          >
            🧑‍💼
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, color: '#111827', fontWeight: 700, lineHeight: 1.1 }}>
              Nico CFO
            </div>
            <div style={{ fontSize: 9, color: '#6b7280' }}>con memoria · vista global</div>
          </div>
          <div
            style={{
              fontSize: 8,
              color: 'oklch(0.43 0.14 155)',
              background: 'oklch(0.43 0.14 155 / 0.1)',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            EN VIVO
          </div>
        </div>
        {/* User question bubble */}
        <div
          style={{
            background: 'oklch(0.43 0.14 155)',
            color: '#fff',
            borderRadius: '12px 12px 4px 12px',
            padding: '7px 11px',
            fontSize: 10.5,
            fontWeight: 500,
            marginLeft: 36,
            marginBottom: 6,
            lineHeight: 1.4,
          }}
        >
          ¿Qué hago para estar tranquilo frente a la DIAN?
        </div>
        {/* Nico answer */}
        <div
          style={{
            background: '#f3f4f6',
            borderRadius: '12px 12px 12px 4px',
            padding: '7px 11px',
            fontSize: 10.5,
            color: '#374151',
            lineHeight: 1.4,
          }}
        >
          Tu score es 72/100. Lo más urgente: el descuadre de inventario Siigo vs físico por $136M…
        </div>
      </div>
    </div>
  );
}
