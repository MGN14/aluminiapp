import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Zap, Plug, Check } from 'lucide-react';
import { BRAND, INK, INK2, INK3 } from './OnboardingShell';

interface Option {
  id: string;
  label: string;
  integrable?: boolean;
}

const OPTIONS: Option[] = [
  { id: 'siigo', label: 'Siigo', integrable: true },
  { id: 'alegra', label: 'Alegra' },
  { id: 'world_office', label: 'World Office' },
  { id: 'helisa', label: 'Helisa' },
  { id: 'contapyme', label: 'Contapyme' },
  { id: 'facture', label: 'Facture' },
  { id: 'loggro', label: 'Loggro' },
  { id: 'otro', label: 'Otro (escribir)' },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function FacturadorSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const matched = OPTIONS.find(
    (o) => o.id !== 'otro' && o.label.toLowerCase() === value.trim().toLowerCase(),
  );
  const isOtro = value.trim() !== '' && !matched;
  const [otroMode, setOtroMode] = useState(isOtro);
  const selectedLabel = matched ? matched.label : isOtro || otroMode ? 'Otro' : '';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handlePick = (opt: Option) => {
    if (opt.id === 'otro') {
      setOtroMode(true);
      onChange('');
    } else {
      setOtroMode(false);
      onChange(opt.label);
    }
    setOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 500,
          color: INK,
        }}
      >
        ¿Qué facturador electrónico usas?
      </label>

      <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            width: '100%',
            minHeight: 52,
            padding: '10px 14px',
            background: '#fff',
            border: open ? `1.5px solid ${BRAND}` : '1.5px solid rgba(0,0,0,0.07)',
            borderRadius: 12,
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: open ? '0 0 0 4px oklch(0.43 0.14 155 / 0.08)' : 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
        >
          {selectedLabel ? (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {matched?.integrable && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '3px 7px',
                    borderRadius: 99,
                    background: 'oklch(0.43 0.14 155 / 0.10)',
                    color: BRAND,
                  }}
                >
                  <Zap style={{ width: 10, height: 10 }} />
                  Integrable
                </span>
              )}
              <span style={{ fontSize: 14.5, color: INK, fontWeight: 500 }}>{selectedLabel}</span>
            </div>
          ) : (
            <div style={{ flex: 1, color: INK3, fontSize: 14 }}>Elige un facturador…</div>
          )}
          <ChevronDown
            style={{
              width: 17,
              height: 17,
              color: INK2,
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s',
              flexShrink: 0,
            }}
          />
        </button>

        {open && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 14,
              boxShadow: '0 12px 32px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.05)',
              zIndex: 40,
              overflow: 'hidden',
              animation: 'fadeUp 0.18s cubic-bezier(0.16,1,0.3,1) both',
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {OPTIONS.map((opt) => {
              const isSelected =
                opt.id === 'otro'
                  ? otroMode || isOtro
                  : matched?.id === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handlePick(opt)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '11px 14px',
                    border: 'none',
                    background: isSelected ? 'oklch(0.43 0.14 155 / 0.08)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontFamily: 'inherit',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      background: opt.integrable ? 'oklch(0.43 0.14 155 / 0.12)' : '#f5f5f7',
                      color: opt.integrable ? BRAND : INK2,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {opt.integrable ? (
                      <Zap style={{ width: 13, height: 13 }} />
                    ) : (
                      <Plug style={{ width: 13, height: 13 }} />
                    )}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, color: INK, fontWeight: 500 }}>
                    {opt.label}
                  </span>
                  {opt.integrable && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        padding: '3px 7px',
                        borderRadius: 99,
                        background: 'oklch(0.43 0.14 155 / 0.10)',
                        color: BRAND,
                      }}
                    >
                      Conexión automática
                    </span>
                  )}
                  {isSelected && (
                    <Check style={{ width: 15, height: 15, color: BRAND, flexShrink: 0 }} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {(otroMode || isOtro) && (
        <div
          style={{
            animation: 'fieldIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Escribe el nombre de tu facturador…"
            autoFocus
            style={{
              width: '100%',
              height: 48,
              background: '#f5f5f7',
              border: '1.5px solid transparent',
              borderRadius: 12,
              padding: '0 14px',
              fontSize: 14.5,
              fontFamily: 'inherit',
              color: INK,
              outline: 'none',
              transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.borderColor = BRAND;
              e.currentTarget.style.boxShadow = '0 0 0 4px oklch(0.43 0.14 155 / 0.10)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.background = '#f5f5f7';
              e.currentTarget.style.borderColor = 'transparent';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <p style={{ fontSize: 11.5, color: INK2, marginTop: 6, lineHeight: 1.5 }}>
            Por ahora solo conectamos automáticamente con Siigo — con los demás te avisamos cuando
            agreguemos la integración.
          </p>
        </div>
      )}
    </div>
  );
}
