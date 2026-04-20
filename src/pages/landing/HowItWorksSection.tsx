import { Upload, LayoutDashboard, BarChart3 } from 'lucide-react';

const steps = [
  {
    icon: Upload,
    number: '01',
    title: 'Subes tu extracto bancario',
    description: 'Carga el PDF de tu banco. Compatible con la mayoría de bancos en Colombia.',
  },
  {
    icon: LayoutDashboard,
    number: '02',
    title: 'La app organiza y categoriza',
    description: 'AluminIA extrae, clasifica y organiza cada movimiento automáticamente.',
  },
  {
    icon: BarChart3,
    number: '03',
    title: 'Obtienes reportes e inteligencia',
    description: 'Accede a tu PyG, métricas clave y pregúntale a Nico lo que necesites.',
  },
];

export default function HowItWorksSection() {
  return (
    <section
      id="como-funciona"
      style={{
        background: '#fff',
        padding: '120px clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <h2
            style={{
              color: '#1d1d1f',
              fontSize: 'clamp(36px, 4.5vw, 56px)',
              fontWeight: 700,
              letterSpacing: '-1.5px',
              lineHeight: 1.1,
              margin: 0,
              marginBottom: 16,
            }}
          >
            Cómo funciona
          </h2>
          <p
            style={{
              color: 'rgba(29,29,31,0.55)',
              fontSize: 18,
              lineHeight: 1.6,
              maxWidth: 540,
              margin: '0 auto',
            }}
          >
            Empieza en minutos. Sin configuraciones complejas.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 24,
          }}
        >
          {steps.map((step, i) => (
            <div
              key={i}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor = 'oklch(0.43 0.14 155 / 0.4)')
              }
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)')}
              style={{
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.07)',
                borderRadius: 20,
                padding: '28px 24px',
                transition: 'border-color 0.2s',
              }}
            >
              <div
                style={{
                  fontSize: 44,
                  fontWeight: 900,
                  color: 'rgba(29,29,31,0.08)',
                  lineHeight: 1,
                  marginBottom: 16,
                  userSelect: 'none',
                }}
              >
                {step.number}
              </div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'oklch(0.43 0.14 155)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18,
                }}
              >
                <step.icon style={{ width: 22, height: 22, color: '#fff' }} />
              </div>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: '#1d1d1f',
                  margin: 0,
                  marginBottom: 8,
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: 'rgba(29,29,31,0.55)',
                  margin: 0,
                }}
              >
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
