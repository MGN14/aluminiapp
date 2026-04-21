import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useNico } from '@/hooks/useNicoContext';
import nicoAvatar from '@/assets/nico-avatar.png';
import NicoAgentChat from './NicoAgentChat';

export default function NicoDrawer() {
  const { isOpen, closeNico, pageContext } = useNico();

  // Listen for prefill events from CFO Insights
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        // The NicoAgentChat component handles its own input; we dispatch a
        // synthetic custom event it can pick up via its prop interface if needed.
        // For now, just ensure drawer is open — user can paste/use suggestions.
      }
    };
    window.addEventListener('nico-prefill', handler);
    return () => window.removeEventListener('nico-prefill', handler);
  }, []);

  if (!isOpen) return null;

  const BRAND = 'oklch(0.43 0.14 155)';
  const BRAND_DIM = 'oklch(0.43 0.14 155 / 0.10)';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeNico}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          background: 'rgba(0,0,0,0.20)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: 420,
          maxWidth: '100vw',
          background: '#fff',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.12)',
          animation: 'slideInRight 0.38s cubic-bezier(0.16,1,0.3,1)',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, oklch(0.43 0.14 155), oklch(0.55 0.16 180))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 3px oklch(0.43 0.14 155 / 0.15)',
                overflow: 'hidden',
              }}
            >
              <img
                src={nicoAvatar}
                alt="Nico CFO"
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1d1d1f', display: 'flex', alignItems: 'center', gap: 6 }}>
                Nico CFO
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 99,
                    background: BRAND_DIM,
                    fontSize: 10,
                    fontWeight: 600,
                    color: BRAND,
                  }}
                >
                  con memoria
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>
                Tu mano derecha en todo el negocio
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeNico}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Shared CFO chat */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <NicoAgentChat
            agentKey="cfo"
            variant="drawer"
            pageContext={pageContext}
          />
        </div>
      </div>
    </>
  );
}
