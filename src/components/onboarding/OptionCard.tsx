import { Check } from 'lucide-react';
import { BRAND, INK, INK2 } from './OnboardingShell';

interface Props {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  footnote?: React.ReactNode;  // extra small grey line at the bottom
  size?: 'md' | 'lg';
  disabled?: boolean;
}

export default function OptionCard({
  selected,
  onClick,
  icon,
  title,
  description,
  footnote,
  size = 'md',
  disabled = false,
}: Props) {
  const padding = size === 'lg' ? 20 : 16;
  const titleSize = size === 'lg' ? 16 : 15;
  const descSize = size === 'lg' ? 13.5 : 12.5;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        textAlign: 'left',
        padding,
        background: selected ? 'oklch(0.43 0.14 155 / 0.06)' : '#fff',
        border: selected
          ? `1.5px solid ${BRAND}`
          : '1.5px solid rgba(0,0,0,0.07)',
        borderRadius: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s',
        boxShadow: selected
          ? '0 0 0 4px oklch(0.43 0.14 155 / 0.08)'
          : 'none',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
      }}
      onMouseEnter={(e) => {
        if (disabled || selected) return;
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.14)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        if (disabled || selected) return;
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {icon && (
        <div
          style={{
            flexShrink: 0,
            width: size === 'lg' ? 44 : 36,
            height: size === 'lg' ? 44 : 36,
            borderRadius: 10,
            background: selected
              ? 'oklch(0.43 0.14 155 / 0.14)'
              : '#f5f5f7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: selected ? BRAND : INK2,
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {icon}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 600,
            color: INK,
            letterSpacing: '-0.2px',
            marginBottom: description ? 4 : 0,
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: descSize,
              color: INK2,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        )}
        {footnote && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: '#a1a1a6',
              fontStyle: 'italic',
            }}
          >
            {footnote}
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: 99,
          border: selected
            ? `2px solid ${BRAND}`
            : '2px solid rgba(0,0,0,0.12)',
          background: selected ? BRAND : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {selected && <Check style={{ width: 13, height: 13, color: '#fff' }} strokeWidth={3} />}
      </div>
    </button>
  );
}
