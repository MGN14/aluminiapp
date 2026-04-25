import { Check, ArrowRight, Loader2, Sparkles } from 'lucide-react';

export interface PlanData {
  id: string;
  name: string;
  monthlyPrice: number;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaAction: string;
  highlighted: boolean;
  note: string | null;
  badge: string | null;
}

interface PricingCardProps {
  plan: PlanData;
  isAnnual: boolean;
  isCurrentPlan: boolean;
  isLoading: boolean;
  onAction: (action: string) => void;
}

const BRAND = 'oklch(0.43 0.14 155)';
const BRAND_FAINT = 'oklch(0.43 0.14 155 / 0.10)';
const BRAND_BORDER = 'oklch(0.43 0.14 155 / 0.40)';
const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#a1a1a6';

function formatCOP(n: number) {
  return '$' + n.toLocaleString('es-CO');
}

export default function PricingCard({
  plan,
  isAnnual,
  isCurrentPlan,
  isLoading,
  onAction,
}: PricingCardProps) {
  const isFree = plan.monthlyPrice === 0;
  const annualTotal = Math.round(plan.monthlyPrice * 12 * 0.8);
  const annualMonthly = Math.round(annualTotal / 12);
  const annualSavings = plan.monthlyPrice * 12 - annualTotal;

  // Decisión de UX: en plan anual mostramos el precio MENSUAL equivalente
  // ($479,200) en grande, no el total anual ($5,750,400). El total anual se
  // muestra en chiquito debajo. Razón: el salto visual de $599K → $5.7M
  // asusta más de lo que vende, aunque el dato sea el mismo.
  const displayPrice = isFree
    ? '$0'
    : isAnnual
      ? formatCOP(annualMonthly)
      : formatCOP(plan.monthlyPrice);

  const displayPeriod = isFree
    ? 'Para siempre'
    : 'COP / mes';

  const highlighted = plan.highlighted;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        border: highlighted ? `2px solid ${BRAND_BORDER}` : '1.5px solid rgba(0,0,0,0.08)',
        borderRadius: 18,
        padding: 28,
        boxShadow: highlighted
          ? '0 12px 40px oklch(0.43 0.14 155 / 0.12), 0 2px 6px rgba(0,0,0,0.04)'
          : '0 1px 3px rgba(0,0,0,0.04)',
        transform: highlighted ? 'scale(1.02)' : 'none',
        transition: 'transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s',
        zIndex: highlighted ? 2 : 1,
        outline: isCurrentPlan ? `2px solid ${BRAND}` : 'none',
        outlineOffset: 2,
      }}
    >
      {plan.badge && (
        <div
          style={{
            position: 'absolute',
            top: -13,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: BRAND,
              color: '#fff',
              padding: '5px 12px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
              boxShadow: '0 4px 12px oklch(0.43 0.14 155 / 0.25)',
            }}
          >
            <Sparkles style={{ width: 11, height: 11 }} />
            {plan.badge}
          </span>
        </div>
      )}

      {isAnnual && highlighted && (
        <div style={{ position: 'absolute', top: -13, right: 16 }}>
          <span
            style={{
              background: 'oklch(0.70 0.17 70)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 99,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
            }}
          >
            Mejor valor
          </span>
        </div>
      )}

      {isCurrentPlan && !plan.badge && (
        <div style={{ position: 'absolute', top: -13, right: 16 }}>
          <span
            style={{
              background: INK,
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 99,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
            }}
          >
            Tu plan actual
          </span>
        </div>
      )}

      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: INK,
          margin: 0,
          letterSpacing: '-0.3px',
        }}
      >
        {plan.name}
      </h3>
      <p style={{ fontSize: 13, color: INK2, margin: '6px 0 0 0', lineHeight: 1.4 }}>
        {plan.description}
      </p>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: highlighted ? 42 : 36,
            fontWeight: 700,
            color: INK,
            letterSpacing: '-1.5px',
            lineHeight: 1,
          }}
        >
          {displayPrice}
        </span>
        <span style={{ fontSize: 13, color: INK3, fontWeight: 500 }}>{displayPeriod}</span>
      </div>

      {!isFree && isAnnual && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: INK3, margin: 0 }}>
            Antes <s style={{ color: INK3 }}>{formatCOP(plan.monthlyPrice)}</s> /
            mes · {formatCOP(annualTotal)} cobrados una vez al año.
          </p>
          <span
            style={{
              display: 'inline-block',
              marginTop: 6,
              fontSize: 11,
              fontWeight: 600,
              color: BRAND,
              background: BRAND_FAINT,
              padding: '3px 8px',
              borderRadius: 99,
              border: `1px solid oklch(0.43 0.14 155 / 0.20)`,
            }}
          >
            Ahorras {formatCOP(annualSavings)} al año
          </span>
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0 0', flex: 1 }}>
        {plan.features.map((feature, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 10,
              fontSize: 13,
              color: INK2,
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: 99,
                background: highlighted ? BRAND_FAINT : 'rgba(0,0,0,0.04)',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <Check
                style={{
                  width: 11,
                  height: 11,
                  color: highlighted ? BRAND : INK2,
                  strokeWidth: 3,
                }}
              />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.note && (
        <p
          style={{
            fontSize: 11,
            color: INK3,
            fontStyle: 'italic',
            margin: '16px 0 0 0',
            paddingTop: 12,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            lineHeight: 1.5,
          }}
        >
          {plan.note}
        </p>
      )}

      <button
        onClick={() => onAction(plan.ctaAction)}
        disabled={!!isCurrentPlan || isLoading}
        style={{
          marginTop: 24,
          width: '100%',
          height: highlighted ? 46 : 42,
          border: 'none',
          borderRadius: 10,
          cursor: isCurrentPlan || isLoading ? 'not-allowed' : 'pointer',
          fontSize: highlighted ? 14 : 13,
          fontWeight: 600,
          letterSpacing: '-0.1px',
          background: isCurrentPlan
            ? 'rgba(0,0,0,0.06)'
            : highlighted
              ? BRAND
              : plan.id === 'demo'
                ? '#fff'
                : '#f5f5f7',
          color: isCurrentPlan
            ? INK3
            : highlighted
              ? '#fff'
              : INK,
          boxShadow: highlighted && !isCurrentPlan
            ? '0 4px 14px oklch(0.43 0.14 155 / 0.30)'
            : 'none',
          outline: plan.id === 'demo' && !highlighted ? '1.5px solid rgba(0,0,0,0.10)' : 'none',
          outlineOffset: -1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          transition: 'transform 0.15s, box-shadow 0.15s, background 0.15s',
          opacity: isCurrentPlan ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (isCurrentPlan || isLoading) return;
          e.currentTarget.style.transform = 'translateY(-1px)';
          if (highlighted) {
            e.currentTarget.style.boxShadow = '0 8px 20px oklch(0.43 0.14 155 / 0.40)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          if (highlighted && !isCurrentPlan) {
            e.currentTarget.style.boxShadow = '0 4px 14px oklch(0.43 0.14 155 / 0.30)';
          }
        }}
      >
        {isLoading ? (
          <>
            <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
            Redirigiendo...
          </>
        ) : isCurrentPlan ? (
          'Plan actual'
        ) : (
          <>
            {plan.cta}
            <ArrowRight style={{ width: 14, height: 14 }} />
          </>
        )}
      </button>
    </div>
  );
}
