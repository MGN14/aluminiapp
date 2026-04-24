import { Check, X } from 'lucide-react';
import { BRAND, INK, INK2 } from './OnboardingShell';

interface Props {
  label: string;
  description?: React.ReactNode;
  whatWeDo?: React.ReactNode;
  value: boolean | null;
  onChange: (v: boolean) => void;
}

export default function YesNoField({ label, description, whatWeDo, value, onChange }: Props) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 14,
        padding: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, marginBottom: description ? 4 : 0 }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 12.5, color: INK2, lineHeight: 1.5 }}>{description}</div>
        )}
        {whatWeDo && (
          <div
            style={{
              marginTop: 8,
              padding: '7px 10px',
              background: 'oklch(0.43 0.14 155 / 0.06)',
              borderRadius: 8,
              fontSize: 11.5,
              color: BRAND,
              lineHeight: 1.4,
            }}
          >
            <strong style={{ fontWeight: 600 }}>AluminIA: </strong>
            {whatWeDo}
          </div>
        )}
      </div>

      <div style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
        {[
          { v: true, label: 'Sí', Icon: Check },
          { v: false, label: 'No', Icon: X },
        ].map(({ v, label: l, Icon }) => {
          const active = value === v;
          return (
            <button
              key={l}
              type="button"
              onClick={() => onChange(v)}
              style={{
                minWidth: 64,
                height: 38,
                padding: '0 14px',
                border: active
                  ? `1.5px solid ${BRAND}`
                  : '1.5px solid rgba(0,0,0,0.08)',
                background: active ? BRAND : '#fff',
                color: active ? '#fff' : INK,
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                transition: 'all 0.15s',
              }}
            >
              <Icon style={{ width: 13, height: 13 }} strokeWidth={active ? 3 : 2.5} />
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
