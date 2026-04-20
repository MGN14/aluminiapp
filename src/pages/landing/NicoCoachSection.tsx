import { CheckCircle } from 'lucide-react';
import nicoAvatar from '@/assets/nico-avatar.png';

const chatMessages = [
  { role: 'user', text: '¿Cómo cambiaron mis gastos este año?' },
  { role: 'nico', text: '1️⃣ Tus gastos acumulados este año son $38.4M, un 18% más que el mismo período del año anterior.\n2️⃣ El mayor incremento fue en proveedores (+31%).\n3️⃣ La concentración en 3 proveedores representa el 62% del total.\n4️⃣ Considera renegociar condiciones con tus proveedores principales.' },
  { role: 'user', text: '¿Cuánto debo provisionar para impuestos?' },
  { role: 'nico', text: '1️⃣ Tu utilidad neta estimada este mes es $4.8M.\n2️⃣ Deberías provisionar aprox. $1.68M (35%) para renta e impuestos.\n3️⃣ Esto es 12% más que el mes anterior por el aumento en ingresos.\n4️⃣ Separa este valor esta semana antes de comprometer el flujo.' },
];

const benefits = [
  'Respuestas con tus números reales',
  'Comparación automática con períodos anteriores',
  'Detección de anomalías y picos',
  'Recomendaciones ejecutivas concretas',
];

const exampleQuestions = [
  '¿Cuál fue mi proveedor más costoso?',
  '¿Estoy creciendo frente al año pasado?',
  '¿Cuánto debo provisionar para impuestos?',
  '¿Cuál es mi utilidad neta del mes?',
];

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.10)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderRadius: 20,
  padding: '24px 28px',
};

export default function NicoCoachSection() {
  return (
    <section
      style={{
        background: '#080d08',
        padding: '120px clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 48,
            alignItems: 'center',
          }}
        >
          {/* Left: copy */}
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 99,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'oklch(0.75 0.18 155)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: 24,
              }}
            >
              <img
                src={nicoAvatar}
                alt="Nico"
                style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top' }}
              />
              Nico · IA Financiera
            </div>
            <h2
              style={{
                fontSize: 'clamp(32px, 4vw, 48px)',
                fontWeight: 700,
                letterSpacing: '-1.5px',
                lineHeight: 1.1,
                color: '#fff',
                margin: 0,
                marginBottom: 16,
              }}
            >
              Pregúntale a Nico cualquier cosa sobre tu negocio
            </h2>
            <p
              style={{
                color: 'rgba(255,255,255,0.55)',
                fontSize: 18,
                lineHeight: 1.6,
                marginBottom: 28,
              }}
            >
              Nico analiza tus ingresos, gastos y tendencias para darte respuestas claras,
              estratégicas y accionables.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
              {benefits.map((b) => (
                <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <CheckCircle style={{ width: 18, height: 18, color: 'oklch(0.60 0.14 155)', flexShrink: 0 }} />
                  <span style={{ color: '#fff', fontWeight: 500, fontSize: 15 }}>{b}</span>
                </div>
              ))}
            </div>

            <div style={cardStyle}>
              <p
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.5)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginTop: 0,
                  marginBottom: 12,
                }}
              >
                Ejemplos de preguntas
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {exampleQuestions.map((q) => (
                  <div
                    key={q}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 14,
                      color: 'rgba(255,255,255,0.55)',
                    }}
                  >
                    <span style={{ color: 'oklch(0.60 0.14 155)' }}>›</span>
                    {q}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: simulated chat */}
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
            {/* Chat header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                <img src={nicoAvatar} alt="Nico" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Nico</div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'oklch(0.75 0.18 155)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'oklch(0.75 0.18 155)',
                      display: 'inline-block',
                    }}
                  />
                  Activo · Analizando tus datos
                </div>
              </div>
            </div>

            {/* Messages */}
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                maxHeight: 320,
                overflowY: 'auto',
                background: 'rgba(0,0,0,0.2)',
              }}
            >
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  {msg.role === 'nico' && (
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.06)',
                        marginRight: 8,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      <img src={nicoAvatar} alt="Nico" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: '82%',
                      padding: '12px 16px',
                      borderRadius: 16,
                      fontSize: 14,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-line',
                      background:
                        msg.role === 'user'
                          ? 'oklch(0.43 0.14 155)'
                          : 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      border: msg.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.10)',
                      borderBottomRightRadius: msg.role === 'user' ? 4 : 16,
                      borderBottomLeftRadius: msg.role === 'user' ? 16 : 4,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Input placeholder */}
            <div
              style={{
                padding: '16px 20px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(255,255,255,0.45)',
                  fontSize: 14,
                }}
              >
                <span>Pregúntale a Nico...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
