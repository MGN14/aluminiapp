import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { BRAND, INK, INK2, INK3 } from '../OnboardingShell';
import { TOUR_STOPS } from '@/components/tour/tourStops';
import { jumpToStop } from '@/lib/tourState';

interface Props {
  onNavigate: (path: string) => void;
}

export default function Step10Tour({ onNavigate }: Props) {
  const [idx, setIdx] = useState(0);
  const stop = TOUR_STOPS[idx];
  const isLast = idx === TOUR_STOPS.length - 1;
  const { Icon } = stop;

  // Primary CTA: activate the persistent tour overlay starting at this stop,
  // then hard-navigate to the feature. The overlay will guide them through
  // the remaining stops without ever breaking the flow.
  const handleGoToStop = () => {
    jumpToStop(idx);
    onNavigate(stop.path);
  };

  return (
    <div>
      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.8px',
          color: INK,
          marginBottom: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          opacity: 0,
        }}
      >
        Tour guiado
      </h2>
      <p
        style={{
          fontSize: 14.5,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 16,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
          opacity: 0,
        }}
      >
        Te acompañamos por los 6 lugares clave de AluminIA. Al entrar a cada uno, el tour sigue
        contigo en una tarjeta flotante — nunca se corta.
      </p>

      {/* Internal tour progress (6 dots) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 14,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        {TOUR_STOPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                background: done
                  ? BRAND
                  : active
                    ? `linear-gradient(90deg, ${BRAND}, oklch(0.60 0.14 155))`
                    : 'rgba(0,0,0,0.08)',
                transition: 'background 0.3s',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          fontSize: 11,
          color: INK3,
          letterSpacing: 0.3,
          marginBottom: 14,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        Paso {idx + 1} de {TOUR_STOPS.length}
      </div>

      {/* Current stop card (remounts on idx change to re-animate) */}
      <div
        key={stop.id}
        style={{
          background: '#fff',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          animation: 'fieldIn 0.45s cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: 'oklch(0.43 0.14 155 / 0.10)',
              color: BRAND,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon style={{ width: 22, height: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'inline-flex',
                fontSize: 10.5,
                fontWeight: 700,
                color: BRAND,
                background: 'oklch(0.43 0.14 155 / 0.08)',
                padding: '3px 8px',
                borderRadius: 99,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              {stop.pill}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK, letterSpacing: '-0.4px' }}>
              {stop.title}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 14, color: INK2, lineHeight: 1.55, marginBottom: 14 }}>
          {stop.description}
        </p>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 18px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {stop.bullets.map((b, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: INK2,
                lineHeight: 1.5,
              }}
            >
              <Check
                style={{
                  width: 14,
                  height: 14,
                  color: BRAND,
                  flexShrink: 0,
                  marginTop: 3,
                }}
                strokeWidth={3}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={handleGoToStop}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 46,
              padding: '0 18px',
              background: BRAND,
              border: 'none',
              borderRadius: 12,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 18px oklch(0.43 0.14 155 / 0.30)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {stop.cta} y continuar con el tour
            <ArrowRight style={{ width: 14, height: 14 }} />
          </button>

          {!isLast && (
            <button
              type="button"
              onClick={() => setIdx(idx + 1)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 40,
                padding: '0 14px',
                background: 'transparent',
                border: 'none',
                color: INK2,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = INK;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = INK2;
              }}
            >
              Ver el siguiente paso antes de empezar →
            </button>
          )}
        </div>
      </div>

      {idx > 0 && (
        <button
          type="button"
          onClick={() => setIdx(idx - 1)}
          style={{
            marginTop: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            color: INK3,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ← Paso anterior
        </button>
      )}
    </div>
  );
}
