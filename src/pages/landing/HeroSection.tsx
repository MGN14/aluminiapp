import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Play } from 'lucide-react';
import HeroDashboardMockup from './HeroDashboardMockup';

const metrics = [
  { value: 'DIAN', label: 'AL DÍA, SIN SUSTOS' },
  { value: 'SIIGO', label: 'CONECTADO' },
  { value: '24/7', label: 'DECISIONES CON DATOS' },
];

const trustItems = [
  'Facturación DIAN al día — tu contador firma tranquilo',
  'Conectado con Siigo y los principales bancos colombianos',
  'Datos en tiempo real para decidir — no Excel ni intuición',
];

export default function HeroSection() {
  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#080d08',
        minHeight: '90vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(80px, 10vh, 140px) clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      {/* Animated blobs */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-10%',
          left: '-8%',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'oklch(0.35 0.16 155)',
          filter: 'blur(80px)',
          opacity: 0.55,
          animation: 'drift 18s linear infinite alternate',
          animationDelay: '0s',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-6%',
          right: '-10%',
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: 'oklch(0.28 0.12 180)',
          filter: 'blur(80px)',
          opacity: 0.55,
          animation: 'drift 22s linear infinite alternate',
          animationDelay: '-4s',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-12%',
          left: '-6%',
          width: 460,
          height: 460,
          borderRadius: '50%',
          background: 'oklch(0.28 0.12 180)',
          filter: 'blur(80px)',
          opacity: 0.55,
          animation: 'drift 24s linear infinite alternate',
          animationDelay: '-8s',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-10%',
          right: '-8%',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'oklch(0.35 0.16 155)',
          filter: 'blur(80px)',
          opacity: 0.55,
          animation: 'drift 28s linear infinite alternate',
          animationDelay: '-12s',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 1280,
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 60,
          alignItems: 'center',
        }}
        className="hero-grid"
      >
        <style>{`
          @media (min-width: 980px) {
            .hero-grid {
              grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) !important;
              text-align: left !important;
            }
            .hero-text-col {
              text-align: left !important;
              align-items: flex-start !important;
            }
            .hero-text-col h1,
            .hero-text-col p,
            .hero-text-col .hero-cta-row,
            .hero-text-col .hero-microcopy,
            .hero-text-col .hero-trust {
              text-align: left !important;
              justify-content: flex-start !important;
              margin-left: 0 !important;
            }
          }
        `}</style>
        <div
          className="hero-text-col"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            minWidth: 0,
          }}
        >
        {/* Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 99,
            padding: '6px 14px',
            fontSize: 12,
            color: 'rgba(255,255,255,0.7)',
            marginBottom: 28,
          }}
        >
          <span
            className="animate-pulse"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'oklch(0.75 0.18 155)',
              display: 'inline-block',
            }}
          />
          Software financiero para PyMEs en Colombia
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 'clamp(44px, 6.5vw, 88px)',
            fontWeight: 700,
            letterSpacing: '-3px',
            color: '#fff',
            lineHeight: 1.02,
            margin: 0,
            marginBottom: 24,
            maxWidth: 960,
          }}
        >
          Tu PyME al día con la <span style={{ color: 'oklch(0.60 0.14 155)' }}>DIAN</span>.
          <br />
          Tus decisiones con <span style={{ color: 'oklch(0.60 0.14 155)' }}>datos reales</span>.
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 18,
            color: 'rgba(255,255,255,0.55)',
            lineHeight: 1.6,
            maxWidth: 620,
            margin: '0 auto 40px',
          }}
        >
          Conciliación bancaria automática, facturas{' '}
          <span style={{ color: '#fff', fontWeight: 600 }}>DIAN</span> al día y datos en tiempo real para decidir — todo conectado con{' '}
          <span style={{ color: '#fff', fontWeight: 600 }}>Siigo</span> y tus bancos colombianos.
        </p>

        {/* CTAs */}
        <div
          className="hero-cta-row"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <Link to="/signup" style={{ textDecoration: 'none' }}>
            <button
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              style={{
                background: '#fff',
                color: '#1d1d1f',
                borderRadius: 999,
                height: 52,
                padding: '0 26px',
                fontSize: 15,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'transform 0.2s ease',
              }}
            >
              Empieza gratis 14 días
              <ArrowRight style={{ width: 18, height: 18 }} />
            </button>
          </Link>
          <a href="#como-funciona" style={{ textDecoration: 'none' }}>
            <button
              style={{
                background: 'transparent',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 999,
                height: 52,
                padding: '0 26px',
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Play style={{ width: 16, height: 16 }} />
              Ver cómo funciona
            </button>
          </a>
        </div>

        {/* CTA microcopy */}
        <p
          className="hero-microcopy"
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.5)',
            margin: '0 0 40px',
          }}
        >
          Sin tarjeta de crédito · Configura en 5 minutos · Cancela cuando quieras
        </p>

        {/* Metrics strip */}
        <div
          className="hero-trust"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',
            marginBottom: 32,
            width: '100%',
          }}
        >
          {metrics.map((m) => (
            <div
              key={m.label}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16,
                padding: '20px 24px',
                minWidth: 180,
                textAlign: 'left',
              }}
            >
              <div style={{ color: '#fff', fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>
                {m.value}
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  marginTop: 6,
                }}
              >
                {m.label}
              </div>
            </div>
          ))}
        </div>

        {/* Trust bullets */}
        <div
          className="hero-trust"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px 28px',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.55)',
            fontSize: 13,
          }}
        >
          {trustItems.map((item) => (
            <div key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle style={{ width: 14, height: 14, color: 'oklch(0.60 0.14 155)' }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
        </div>
        {/* Right column: dashboard mockup */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          <HeroDashboardMockup />
        </div>
      </div>
    </section>
  );
}
