import { useState } from 'react';
import { BRAND, INK, INK2, INK3 } from './OnboardingShell';

interface Props {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  autoFocus?: boolean;
  monospace?: boolean;
  centered?: boolean;
  icon?: React.ReactNode;
  onlyDigits?: boolean;
  fontSize?: number;
}

export default function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  autoFocus,
  monospace,
  centered,
  icon,
  onlyDigits,
  fontSize,
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 500,
          color: INK,
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        {icon && (
          <div
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: INK3,
              pointerEvents: 'none',
              display: 'inline-flex',
            }}
          >
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => {
            let v = e.target.value;
            if (onlyDigits) v = v.replace(/\D/g, '');
            if (maxLength) v = v.slice(0, maxLength);
            onChange(v);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%',
            height: 52,
            background: focused ? '#fff' : '#f5f5f7',
            border: focused
              ? `1.5px solid ${BRAND}`
              : '1.5px solid transparent',
            boxShadow: focused ? '0 0 0 4px oklch(0.43 0.14 155 / 0.10)' : 'none',
            borderRadius: 12,
            padding: icon ? '0 14px 0 42px' : '0 14px',
            fontSize: fontSize ?? 15,
            fontFamily: monospace
              ? 'ui-monospace, SFMono-Regular, monospace'
              : 'inherit',
            color: INK,
            outline: 'none',
            textAlign: centered ? 'center' : 'left',
            transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
          }}
        />
      </div>
      {hint && (
        <p style={{ fontSize: 11.5, color: INK2, marginTop: 6, lineHeight: 1.5 }}>{hint}</p>
      )}
    </div>
  );
}
