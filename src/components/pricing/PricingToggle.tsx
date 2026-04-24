interface PricingToggleProps {
  isAnnual: boolean;
  onToggle: (annual: boolean) => void;
}

const BRAND = 'oklch(0.43 0.14 155)';
const INK = '#1d1d1f';
const INK2 = '#6e6e73';

export default function PricingToggle({ isAnnual, onToggle }: PricingToggleProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderRadius: 99,
        background: '#f5f5f7',
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <button
        onClick={() => onToggle(false)}
        style={{
          padding: '8px 18px',
          borderRadius: 99,
          border: 'none',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          background: !isAnnual ? '#fff' : 'transparent',
          color: !isAnnual ? INK : INK2,
          boxShadow: !isAnnual ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        Mensual
      </button>
      <button
        onClick={() => onToggle(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 18px',
          borderRadius: 99,
          border: 'none',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          background: isAnnual ? BRAND : 'transparent',
          color: isAnnual ? '#fff' : INK2,
          boxShadow: isAnnual ? '0 2px 8px oklch(0.43 0.14 155 / 0.25)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        Anual
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 99,
            background: isAnnual ? 'rgba(255,255,255,0.18)' : 'oklch(0.43 0.14 155 / 0.12)',
            color: isAnnual ? '#fff' : BRAND,
            letterSpacing: '0.2px',
          }}
        >
          −20%
        </span>
      </button>
    </div>
  );
}
