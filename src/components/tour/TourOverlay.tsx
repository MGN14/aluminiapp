// Floating tour overlay. Sits on top of the app while a guided tour is active.
// State lives in localStorage (src/lib/tourState.ts) so it survives navigation
// and hard reloads.
//
// Hidden on auth / onboarding / marketing routes.

import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, X, Minimize2, Maximize2, CheckCircle2 } from 'lucide-react';
import { TOUR_STOPS } from './tourStops';
import {
  advanceTour,
  endTour,
  setMinimized,
  useTourState,
} from '@/lib/tourState';

const BRAND = 'oklch(0.43 0.14 155)';
const BRAND_BRIGHT = 'oklch(0.60 0.14 155)';
const INK = '#1d1d1f';
const INK2 = '#6e6e73';

// Routes where the overlay should never appear (auth / landing / onboarding).
const HIDDEN_PATHS = new Set<string>([
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/change-password',
  '/onboarding',
  '/terms',
  '/privacy',
  '/pricing',
  '/contact',
]);

export default function TourOverlay() {
  const state = useTourState();
  const location = useLocation();
  const navigate = useNavigate();

  if (!state.active) return null;
  if (HIDDEN_PATHS.has(location.pathname)) return null;
  if (state.stopIdx >= TOUR_STOPS.length) {
    // Defensive: clamp + finish.
    endTour();
    return null;
  }

  const stop = TOUR_STOPS[state.stopIdx];
  const isLast = state.stopIdx === TOUR_STOPS.length - 1;
  const { Icon } = stop;

  const handleNext = () => {
    if (isLast) {
      endTour();
      return;
    }
    advanceTour();
    // Navigate to next stop's canonical path
    const nextStop = TOUR_STOPS[state.stopIdx + 1];
    if (nextStop) navigate(nextStop.path);
  };

  const handleGoToStop = () => {
    navigate(stop.path);
  };

  const onCanonicalPath = location.pathname === stop.path;

  // Minimized pill variant
  if (state.minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label="Mostrar tour guiado"
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          zIndex: 60,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 44,
          padding: '0 14px 0 10px',
          background: '#fff',
          border: `1px solid ${BRAND}`,
          borderRadius: 999,
          boxShadow: '0 10px 30px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
          cursor: 'pointer',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
          animation: 'fadeUp 0.3s cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: BRAND,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon style={{ width: 14, height: 14 }} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
          Tour · Paso {state.stopIdx + 1}/{TOUR_STOPS.length}
        </span>
        <Maximize2 style={{ width: 13, height: 13, color: INK2 }} />
      </button>
    );
  }

  // Expanded card
  return (
    <div
      role="dialog"
      aria-label="Tour guiado de AluminIA"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 60,
        width: 340,
        maxWidth: 'calc(100vw - 40px)',
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 16,
        boxShadow: '0 22px 50px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.08)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
        overflow: 'hidden',
        animation: 'fadeUp 0.35s cubic-bezier(0.16,1,0.3,1) both',
      }}
    >
      {/* Brand strip */}
      <div
        style={{
          height: 4,
          background: `linear-gradient(90deg, ${BRAND}, ${BRAND_BRIGHT})`,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px 8px',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'oklch(0.43 0.14 155 / 0.10)',
            color: BRAND,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon style={{ width: 18, height: 18 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: BRAND,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            Tour · Paso {state.stopIdx + 1} de {TOUR_STOPS.length}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: INK,
              letterSpacing: '-0.3px',
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {stop.title}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimizar tour"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: INK2,
            padding: 4,
            display: 'inline-flex',
            borderRadius: 6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Minimize2 style={{ width: 14, height: 14 }} />
        </button>
        <button
          type="button"
          onClick={() => endTour()}
          aria-label="Terminar tour"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: INK2,
            padding: 4,
            display: 'inline-flex',
            borderRadius: 6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Progress */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '10px 14px 0',
        }}
      >
        {TOUR_STOPS.map((s, i) => {
          const done = i < state.stopIdx;
          const active = i === state.stopIdx;
          return (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 99,
                background: done
                  ? BRAND
                  : active
                    ? `linear-gradient(90deg, ${BRAND}, ${BRAND_BRIGHT})`
                    : 'rgba(0,0,0,0.08)',
              }}
            />
          );
        })}
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px 14px' }}>
        <div
          style={{
            display: 'inline-flex',
            fontSize: 10,
            fontWeight: 700,
            color: BRAND,
            background: 'oklch(0.43 0.14 155 / 0.08)',
            padding: '3px 7px',
            borderRadius: 99,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          {stop.pill}
        </div>
        <p
          style={{
            fontSize: 13,
            color: INK2,
            lineHeight: 1.55,
            margin: '0 0 12px',
          }}
        >
          {stop.overlayHint}
        </p>

        {!onCanonicalPath && (
          <button
            type="button"
            onClick={handleGoToStop}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 38,
              padding: '0 12px',
              background: 'rgba(0,0,0,0.04)',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 10,
              color: INK,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: 8,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
          >
            Ir a {stop.title.toLowerCase()}
          </button>
        )}

        <button
          type="button"
          onClick={handleNext}
          style={{
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 44,
            padding: '0 16px',
            background: BRAND,
            border: 'none',
            borderRadius: 11,
            color: '#fff',
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 6px 18px oklch(0.43 0.14 155 / 0.28)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {isLast ? (
            <>
              <CheckCircle2 style={{ width: 15, height: 15 }} />
              Terminar tour
            </>
          ) : (
            <>
              Siguiente paso
              <ChevronRight style={{ width: 15, height: 15 }} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
