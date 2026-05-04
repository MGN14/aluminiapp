import { Shield, Lock, FileCheck, Building2, Sparkles } from 'lucide-react';

const trustItems = [
  {
    icon: Shield,
    label: 'Encriptación bancaria',
    sub: 'AES-256 en tránsito y reposo',
  },
  {
    icon: Lock,
    label: 'Datos en tu control',
    sub: 'Solo lectura · Cancelas cuando quieras',
  },
  {
    icon: FileCheck,
    label: 'DIAN-friendly',
    sub: 'IVA, ReteICA y ReteFuente automáticos',
  },
  {
    icon: Building2,
    label: 'Conexión Siigo + bancos',
    sub: 'Bancolombia, Davivienda, BBVA y más',
  },
  {
    icon: Sparkles,
    label: 'Hecho en Colombia',
    sub: 'Soporte en español · Atención local',
  },
];

export default function SocialProofStrip() {
  return (
    <section
      style={{
        background: '#fafafa',
        borderTop: '1px solid rgba(0,0,0,0.05)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        padding: '40px clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            letterSpacing: '0.12em',
            color: 'rgba(29,29,31,0.5)',
            textTransform: 'uppercase',
            margin: '0 0 24px',
            fontWeight: 600,
          }}
        >
          Construido para empresarios colombianos
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
          }}
        >
          {trustItems.map((item) => (
            <div
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'oklch(0.43 0.14 155 / 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <item.icon
                  style={{
                    width: 18,
                    height: 18,
                    color: 'oklch(0.43 0.14 155)',
                  }}
                />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1d1d1f',
                    lineHeight: 1.3,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(29,29,31,0.55)',
                    lineHeight: 1.4,
                    marginTop: 2,
                  }}
                >
                  {item.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
