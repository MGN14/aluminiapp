import { FileSpreadsheet, ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react';

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif";

export const BRAND = 'oklch(0.43 0.14 155)';
export const BRAND_BRIGHT = 'oklch(0.60 0.14 155)';
export const INK = '#1d1d1f';
export const INK2 = '#6e6e73';
export const INK3 = '#a1a1a6';

export const STEP_LABELS = [
  'Bienvenida',
  'Persona',
  'NIT',
  'Régimen',
  'Responsabilidades',
  'Actividad',
  'Siigo',
  'Revisión',
  'Listo',
  'Tour',
];

interface Props {
  stepIndex: number;           // 0 = welcome, 9 = tour (10 total)
  leftHeadline: React.ReactNode;
  leftSubtitle?: React.ReactNode;
  leftExtra?: React.ReactNode;  // optional illustration / callout for the dark panel
  children: React.ReactNode;    // right panel content
  onBack?: () => void;
  onNext?: () => void;
  canGoNext?: boolean;
  nextLabel?: string;
  nextLoading?: boolean;
  hideBack?: boolean;
  hideNext?: boolean;
  nextIsPrimary?: boolean;     // force primary styling
  nextIcon?: React.ReactNode;   // override icon
}

export default function OnboardingShell({
  stepIndex,
  leftHeadline,
  leftSubtitle,
  leftExtra,
  children,
  onBack,
  onNext,
  canGoNext = true,
  nextLabel = 'Continuar',
  nextLoading = false,
  hideBack = false,
  hideNext = false,
  nextIcon,
}: Props) {
  return (
    <div
      className="min-h-screen flex"
      style={{ fontFamily: FONT_STACK, WebkitFontSmoothing: 'antialiased' }}
    >
      {/* LEFT PANEL (dark) ─────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between"
        style={{
          width: '52%',
          background: '#080d08',
          position: 'relative',
          overflow: 'hidden',
          padding: '48px 52px',
        }}
      >
        {/* Animated blobs */}
        <div
          style={{
            position: 'absolute',
            width: 520,
            height: 520,
            borderRadius: '50%',
            filter: 'blur(80px)',
            opacity: 0.55,
            background: 'oklch(0.35 0.16 155)',
            top: -120,
            left: -100,
            animation: 'drift 18s linear infinite alternate',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 380,
            height: 380,
            borderRadius: '50%',
            filter: 'blur(80px)',
            opacity: 0.55,
            background: 'oklch(0.28 0.12 180)',
            bottom: -80,
            right: -60,
            animation: 'drift 22s linear infinite alternate',
            animationDelay: '-5s',
          }}
        />

        {/* Logo */}
        <div style={{ position: 'relative', zIndex: 1 }} className="flex items-center gap-3">
          <div
            style={{
              width: 38,
              height: 38,
              background: BRAND,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileSpreadsheet className="w-5 h-5 text-white" />
          </div>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>
            AluminIA
          </span>
        </div>

        {/* Headline + subtitle */}
        <div style={{ position: 'relative', zIndex: 1, marginTop: 60 }}>
          <h1
            style={{
              fontSize: 'clamp(30px,3.2vw,44px)',
              fontWeight: 700,
              letterSpacing: '-1.2px',
              lineHeight: 1.08,
              color: '#fff',
              marginBottom: 14,
            }}
          >
            {leftHeadline}
          </h1>
          {leftSubtitle && (
            <p
              style={{
                fontSize: 15,
                color: 'rgba(255,255,255,0.55)',
                lineHeight: 1.6,
                maxWidth: 380,
              }}
            >
              {leftSubtitle}
            </p>
          )}
        </div>

        {/* Optional extra content */}
        {leftExtra ? (
          <div style={{ position: 'relative', zIndex: 1 }}>{leftExtra}</div>
        ) : (
          <div />
        )}

        {/* Progress pills (10 steps) */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {STEP_LABELS.map((label, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <div
                  key={label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 500,
                    background: active
                      ? 'oklch(0.43 0.14 155 / 0.20)'
                      : done
                        ? 'rgba(255,255,255,0.08)'
                        : 'transparent',
                    border: active
                      ? '1px solid oklch(0.60 0.14 155 / 0.45)'
                      : '1px solid rgba(255,255,255,0.10)',
                    color: active
                      ? BRAND_BRIGHT
                      : done
                        ? 'rgba(255,255,255,0.75)'
                        : 'rgba(255,255,255,0.40)',
                    transition: 'all 0.2s',
                  }}
                >
                  {done && <Check style={{ width: 10, height: 10 }} />}
                  {i + 1}. {label}
                </div>
              );
            })}
          </div>
          <div
            style={{
              height: 4,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 99,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${((stepIndex + 1) / STEP_LABELS.length) * 100}%`,
                background: `linear-gradient(90deg, ${BRAND}, ${BRAND_BRIGHT})`,
                transition: 'width 0.4s cubic-bezier(0.16,1,0.3,1)',
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', letterSpacing: 0.3 }}>
            Paso {stepIndex + 1} de {STEP_LABELS.length}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL (form) ────────────────────────────────────────── */}
      <div
        className="flex flex-col w-full"
        style={{
          background: '#ffffff',
          padding: '32px 24px',
          flex: 1,
          minHeight: '100vh',
        }}
      >
        {/* Mobile header (logo + progress text) */}
        <div
          className="flex lg:hidden items-center justify-between"
          style={{ marginBottom: 28, maxWidth: 520, width: '100%', margin: '0 auto 28px' }}
        >
          <div className="flex items-center gap-2">
            <div
              style={{
                width: 32,
                height: 32,
                background: BRAND,
                borderRadius: 9,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileSpreadsheet className="w-4 h-4 text-white" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: INK }}>AluminIA</span>
          </div>
          <span style={{ fontSize: 12, color: INK3 }}>
            {stepIndex + 1} / {STEP_LABELS.length}
          </span>
        </div>

        {/* Main content area */}
        <div
          className="w-full mx-auto flex-1 flex flex-col justify-center"
          style={{
            maxWidth: 560,
            animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both',
          }}
          key={stepIndex /* re-mount on step change to re-trigger animations */}
        >
          {children}
        </div>

        {/* Footer: back + next */}
        {(!hideBack || !hideNext) && (
          <div
            className="w-full mx-auto flex items-center justify-between"
            style={{
              maxWidth: 560,
              paddingTop: 24,
              marginTop: 24,
              borderTop: '1px solid rgba(0,0,0,0.06)',
              gap: 12,
            }}
          >
            {!hideBack && onBack ? (
              <button
                type="button"
                onClick={onBack}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 44,
                  padding: '0 16px',
                  background: 'transparent',
                  border: '1.5px solid rgba(0,0,0,0.07)',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: INK,
                  cursor: 'pointer',
                  fontFamily: FONT_STACK,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.14)';
                  e.currentTarget.style.background = 'rgba(0,0,0,0.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <ArrowLeft style={{ width: 15, height: 15 }} />
                Atrás
              </button>
            ) : (
              <div />
            )}

            {!hideNext && onNext && (
              <button
                type="button"
                onClick={onNext}
                disabled={!canGoNext || nextLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 48,
                  padding: '0 22px',
                  background: INK,
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                  cursor: !canGoNext || nextLoading ? 'not-allowed' : 'pointer',
                  opacity: !canGoNext || nextLoading ? 0.4 : 1,
                  fontFamily: FONT_STACK,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!canGoNext || nextLoading) return;
                  e.currentTarget.style.transform = 'scale(1.01)';
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {nextLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    {nextLabel}
                    {nextIcon ?? <ArrowRight style={{ width: 15, height: 15 }} />}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
