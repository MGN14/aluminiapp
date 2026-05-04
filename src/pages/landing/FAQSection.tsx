import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';

const faqs = [
  {
    q: '¿Cómo protegen mis datos bancarios?',
    a: 'AluminIA usa encriptación AES-256 tanto en tránsito como en reposo, los mismos estándares que tu banco. Solo guardamos lecturas de tus extractos — nunca tenemos credenciales para mover dinero. Podés revocar el acceso en cualquier momento.',
  },
  {
    q: '¿Reemplaza a mi contador?',
    a: 'No. AluminIA es el auxiliar que tu contador necesitaba: organiza extractos, concilia facturas y prepara los números. Tu contador sigue siendo quien revisa, firma y presenta ante la DIAN. La diferencia es que ahora llega a fin de mes con todo listo, no con una caja de Excels.',
  },
  {
    q: '¿Funciona con mi banco?',
    a: 'Soportamos los principales bancos colombianos: Bancolombia, Davivienda, BBVA, Banco de Bogotá, Banco Popular, Itaú, Scotiabank Colpatria y más. Si tu banco no está, subís el PDF del extracto y la IA lo procesa igual.',
  },
  {
    q: '¿Qué pasa cuando termina el trial de 14 días?',
    a: 'No se te cobra nada automáticamente porque no pedimos tarjeta al inicio. Cuando termina el trial podés activar el plan Empresarial ($599.000 COP/mes) o seguir con acceso de solo lectura a tus datos. Vos decidís.',
  },
  {
    q: '¿Cuánto tiempo toma configurarlo?',
    a: 'Menos de 5 minutos. Creás la cuenta, conectás tu banco principal (o subís un PDF), y la IA empieza a categorizar. En 24 horas ya tenés tu primer reporte de PyG y conciliación.',
  },
  {
    q: '¿Puedo cancelar cuando quiera?',
    a: 'Sí. No hay permanencia ni letra chica. Cancelás desde tu panel y mantenés acceso de solo lectura para descargar tus datos cuando quieras.',
  },
];

export default function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq"
      style={{
        background: '#fff',
        padding: '120px clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
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
            Preguntas frecuentes
          </h2>
          <p
            style={{
              color: 'rgba(29,29,31,0.55)',
              fontSize: 18,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Todo lo que un empresario colombiano pregunta antes de empezar.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {faqs.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                style={{
                  border: '1px solid rgba(0,0,0,0.07)',
                  borderRadius: 16,
                  background: isOpen ? '#fafafa' : '#fff',
                  transition: 'background 0.2s',
                }}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '20px 24px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#1d1d1f',
                      lineHeight: 1.4,
                    }}
                  >
                    {item.q}
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: isOpen ? 'oklch(0.43 0.14 155)' : 'rgba(0,0,0,0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.2s',
                    }}
                  >
                    {isOpen ? (
                      <Minus style={{ width: 16, height: 16, color: '#fff' }} />
                    ) : (
                      <Plus style={{ width: 16, height: 16, color: '#1d1d1f' }} />
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      padding: '0 24px 24px',
                      fontSize: 15,
                      lineHeight: 1.7,
                      color: 'rgba(29,29,31,0.7)',
                    }}
                  >
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
