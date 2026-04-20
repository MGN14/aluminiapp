import { CheckCircle, ShieldCheck } from 'lucide-react';

const benefits = [
  'Estimación mensual de impuestos',
  'Proyección anual de obligaciones',
  'Identificación de gastos deducibles',
  'Mayor claridad para tu contador',
];

export default function DIANSection() {
  return (
    <section
      style={{
        padding: '0 clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      <div
        className="dian-card"
        style={{
          background: '#1d1d1f',
          borderRadius: 24,
          padding: 48,
          margin: '80px auto',
          maxWidth: 1100,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 48,
        }}
      >
        <style>{`
          @media (max-width: 768px) {
            .dian-card {
              grid-template-columns: 1fr !important;
              padding: 32px !important;
              gap: 32px !important;
            }
          }
        `}</style>

        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'oklch(0.43 0.14 155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <ShieldCheck style={{ width: 24, height: 24, color: '#fff' }} />
          </div>
          <h2
            style={{
              fontSize: 'clamp(28px, 3vw, 40px)',
              fontWeight: 700,
              letterSpacing: '-1px',
              lineHeight: 1.1,
              color: '#fff',
              margin: 0,
              marginBottom: 16,
            }}
          >
            Evita sanciones. Prepárate para la DIAN.
          </h2>
          <p
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 16,
              lineHeight: 1.65,
              margin: 0,
            }}
          >
            Conoce tu utilidad real y estima tus impuestos antes de que sea tarde. La información
            está ahí — AluminIA la hace visible.
          </p>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.5)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: 0,
              marginBottom: 20,
            }}
          >
            Qué obtienes
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {benefits.map((b) => (
              <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <CheckCircle
                  style={{
                    width: 20,
                    height: 20,
                    color: 'oklch(0.60 0.14 155)',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                />
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 500 }}>{b}</span>
              </div>
            ))}
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.4)',
              lineHeight: 1.6,
              marginTop: 24,
              marginBottom: 0,
            }}
          >
            * Las estimaciones son orientativas y no reemplazan asesoría contable profesional.
          </p>
        </div>
      </div>
    </section>
  );
}
