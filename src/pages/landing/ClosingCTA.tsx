import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function ClosingCTA() {
  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#080d08',
        padding: '140px clamp(20px, 5vw, 60px)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-15%',
          left: '-8%',
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: 'oklch(0.35 0.16 155)',
          filter: 'blur(80px)',
          opacity: 0.55,
          animation: 'drift 22s linear infinite alternate',
          animationDelay: '0s',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-18%',
          right: '-10%',
          width: 560,
          height: 560,
          borderRadius: '50%',
          background: 'oklch(0.28 0.12 180)',
          filter: 'blur(80px)',
          opacity: 0.55,
          animation: 'drift 28s linear infinite alternate',
          animationDelay: '-6s',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 760,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(36px, 5vw, 72px)',
            fontWeight: 700,
            letterSpacing: '-2px',
            lineHeight: 1.05,
            color: '#fff',
            margin: 0,
            marginBottom: 20,
          }}
        >
          Tus números ya están hablando.
          <br />
          <span style={{ color: 'oklch(0.60 0.14 155)' }}>Ahora puedes escucharlos.</span>
        </h2>
        <p
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 18,
            lineHeight: 1.6,
            maxWidth: 520,
            margin: '0 auto 40px',
          }}
        >
          Únete a los empresarios colombianos que ya toman decisiones con información real.
        </p>
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
            Empieza gratis
            <ArrowRight style={{ width: 18, height: 18 }} />
          </button>
        </Link>
        <p
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.45)',
            marginTop: 20,
            marginBottom: 0,
          }}
        >
          Sin tarjeta de crédito · Sin contrato · Cancela cuando quieras
        </p>
      </div>
    </section>
  );
}
