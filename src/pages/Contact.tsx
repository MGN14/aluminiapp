import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Send, Mail, MessageSquare, CheckCircle2, Loader2, Clock } from 'lucide-react';
import Footer from '@/components/layout/Footer';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';

const BRAND = 'oklch(0.43 0.14 155)';
const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#a1a1a6';
const SURFACE = '#f5f5f7';

const contactSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100, 'Nombre muy largo'),
  email: z.string().trim().email('Correo electrónico inválido').max(255, 'Email muy largo'),
  message: z.string().trim().min(10, 'El mensaje debe tener al menos 10 caracteres').max(1000, 'Mensaje muy largo'),
});

export default function Contact() {
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = contactSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('send-contact', {
        body: {
          name: result.data.name,
          email: result.data.email,
          message: result.data.message,
        },
      });

      if (error) {
        setErrors({ message: 'Error al enviar el mensaje. Por favor intenta de nuevo.' });
        setLoading(false);
        return;
      }
      setSuccess(true);
    } catch {
      setErrors({ message: 'Error de conexión. Por favor intenta de nuevo.' });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', background: SURFACE, display: 'flex', flexDirection: 'column' }}>
        <LandingHeader />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
          <div
            style={{
              maxWidth: 440,
              width: '100%',
              background: '#fff',
              border: '1.5px solid rgba(0,0,0,0.07)',
              borderRadius: 18,
              padding: 36,
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                margin: '0 auto 20px',
                borderRadius: 99,
                background: 'oklch(0.43 0.14 155 / 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'popIn 0.5s cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <CheckCircle2 style={{ width: 32, height: 32, color: BRAND }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: 0, letterSpacing: '-0.5px' }}>
              ¡Mensaje enviado!
            </h2>
            <p style={{ fontSize: 14, color: INK2, margin: '10px 0 24px', lineHeight: 1.5 }}>
              Gracias por contactarnos. Te responderemos en menos de 24 horas hábiles.
            </p>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <button
                style={{
                  padding: '12px 22px',
                  height: 42,
                  border: '1.5px solid rgba(0,0,0,0.10)',
                  borderRadius: 10,
                  background: '#fff',
                  color: INK,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Volver al inicio
              </button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: SURFACE, display: 'flex', flexDirection: 'column' }}>
      <LandingHeader />

      <main style={{ flex: 1, padding: '64px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h1
              style={{
                fontSize: 44,
                fontWeight: 700,
                color: INK,
                margin: 0,
                letterSpacing: '-1.5px',
                lineHeight: 1.1,
              }}
            >
              Hablemos
            </h1>
            <p
              style={{
                fontSize: 17,
                color: INK2,
                maxWidth: 520,
                margin: '16px auto 0',
                lineHeight: 1.5,
              }}
            >
              Estamos aquí para responder tus preguntas y escuchar lo que piensas.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
              gap: 28,
            }}
          >
            <div
              style={{
                background: '#fff',
                border: '1.5px solid rgba(0,0,0,0.07)',
                borderRadius: 18,
                padding: 32,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <h2 style={{ fontSize: 19, fontWeight: 700, color: INK, margin: 0, letterSpacing: '-0.3px' }}>
                Envíanos un mensaje
              </h2>
              <p style={{ fontSize: 13, color: INK2, margin: '6px 0 24px' }}>
                Completa el formulario y te contactamos pronto.
              </p>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field
                  label="Nombre"
                  error={errors.name}
                >
                  <input
                    type="text"
                    placeholder="Tu nombre"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    style={inputStyle(!!errors.name)}
                    onFocus={(e) => { if (!errors.name) e.currentTarget.style.borderColor = BRAND; }}
                    onBlur={(e) => { if (!errors.name) e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'; }}
                  />
                </Field>

                <Field
                  label="Correo electrónico"
                  error={errors.email}
                >
                  <input
                    type="email"
                    placeholder="tu@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={inputStyle(!!errors.email)}
                    onFocus={(e) => { if (!errors.email) e.currentTarget.style.borderColor = BRAND; }}
                    onBlur={(e) => { if (!errors.email) e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'; }}
                  />
                </Field>

                <Field
                  label="Mensaje"
                  error={errors.message}
                >
                  <textarea
                    placeholder="¿En qué podemos ayudarte?"
                    rows={5}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    style={{ ...inputStyle(!!errors.message), minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }}
                    onFocus={(e) => { if (!errors.message) e.currentTarget.style.borderColor = BRAND; }}
                    onBlur={(e) => { if (!errors.message) e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'; }}
                  />
                </Field>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    marginTop: 6,
                    height: 46,
                    border: 'none',
                    borderRadius: 10,
                    background: BRAND,
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px oklch(0.43 0.14 155 / 0.25)',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (loading) return;
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 8px 20px oklch(0.43 0.14 155 / 0.35)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 14px oklch(0.43 0.14 155 / 0.25)';
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send style={{ width: 16, height: 16 }} />
                      Enviar mensaje
                    </>
                  )}
                </button>
                <p style={{ fontSize: 11, color: INK3, textAlign: 'center', margin: 0 }}>
                  Te respondemos en menos de 24h hábiles.
                </p>
              </form>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <InfoCard
                icon={<Mail style={{ width: 18, height: 18, color: BRAND }} />}
                title="Correo electrónico"
                subtitle="Consultas generales y soporte técnico"
              >
                <a
                  href="mailto:soporte@aluminia.app"
                  style={{ color: BRAND, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
                >
                  soporte@aluminia.app
                </a>
              </InfoCard>

              <InfoCard
                icon={<Clock style={{ width: 18, height: 18, color: BRAND }} />}
                title="Tiempo de respuesta"
                subtitle="Horario laboral colombiano"
              >
                <p style={{ fontSize: 13, color: INK2, margin: 0, lineHeight: 1.5 }}>
                  Normalmente respondemos en menos de 24 horas hábiles. Usuarios con plan Profesional tienen soporte prioritario.
                </p>
              </InfoCard>

              <div
                style={{
                  background: 'oklch(0.43 0.14 155 / 0.06)',
                  border: '1px solid oklch(0.43 0.14 155 / 0.20)',
                  borderRadius: 14,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <MessageSquare style={{ width: 16, height: 16, color: BRAND, flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: 12, color: INK2, margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: INK, fontWeight: 600 }}>Tip:</strong>{' '}
                  Para reportar errores en extractos PDF, incluye el nombre del banco y la fecha aproximada del problema.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: INK, letterSpacing: '0.1px' }}>{label}</label>
      {children}
      {error && (
        <p style={{ fontSize: 11, color: 'oklch(0.58 0.20 25)', margin: 0, fontWeight: 500 }}>{error}</p>
      )}
    </div>
  );
}

function InfoCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1.5px solid rgba(0,0,0,0.07)',
        borderRadius: 14,
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'oklch(0.43 0.14 155 / 0.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, letterSpacing: '-0.1px' }}>{title}</div>
          <div style={{ fontSize: 11, color: INK3, marginTop: 1 }}>{subtitle}</div>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%',
    height: 44,
    padding: '0 14px',
    borderRadius: 12,
    border: `1.5px solid ${hasError ? 'oklch(0.58 0.20 25)' : 'rgba(0,0,0,0.12)'}`,
    fontSize: 14,
    color: INK,
    background: '#fff',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    outline: 'none',
  };
}

function LandingHeader() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${BRAND}, oklch(0.55 0.12 165))`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileSpreadsheet style={{ width: 16, height: 16, color: '#fff' }} />
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: '-0.3px' }}>AluminIA</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/login" style={{ textDecoration: 'none' }}>
            <button
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 99,
                border: '1px solid rgba(0,0,0,0.10)',
                background: '#fff',
                color: INK,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Iniciar sesión
            </button>
          </Link>
          <Link to="/signup" style={{ textDecoration: 'none' }}>
            <button
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 99,
                border: 'none',
                background: INK,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Crear cuenta
            </button>
          </Link>
        </div>
      </div>
    </header>
  );
}
