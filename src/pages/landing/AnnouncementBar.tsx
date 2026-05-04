import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function AnnouncementBar() {
  return (
    <Link
      to="/signup"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        height: 36,
        background: 'oklch(0.43 0.14 155)',
        color: '#fff',
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: '-0.1px',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
        padding: '0 16px',
        textAlign: 'center',
      }}
    >
      <Sparkles style={{ width: 14, height: 14, flexShrink: 0 }} />
      <span>
        <strong style={{ fontWeight: 700 }}>14 días gratis</strong> — Sin tarjeta de crédito
      </span>
      <ArrowRight style={{ width: 14, height: 14, flexShrink: 0 }} />
    </Link>
  );
}
