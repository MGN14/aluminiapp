import { useEffect, useRef, useState } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { CIIU_CODES, searchCiiuCodes, findCiiuByCode, type ActividadTag } from '@/data/ciiuCodes';
import { BRAND, INK, INK2, INK3 } from './OnboardingShell';

interface Props {
  value: string;
  onChange: (code: string) => void;
  actividad: ActividadTag | null;
}

export default function CIIUCombobox({ value, onChange, actividad }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = findCiiuByCode(value);
  const filterActividad = showAll ? null : actividad;
  const results = searchCiiuCodes(query, filterActividad).slice(0, 60);

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

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [open]);

  const totalForActivity = actividad
    ? CIIU_CODES.filter(c => c.tags.includes(actividad)).length
    : CIIU_CODES.length;

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          minHeight: 56,
          padding: '10px 14px',
          background: '#fff',
          border: open
            ? `1.5px solid ${BRAND}`
            : '1.5px solid rgba(0,0,0,0.07)',
          borderRadius: 12,
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: open ? '0 0 0 4px oklch(0.43 0.14 155 / 0.08)' : 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {selected ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                color: BRAND,
                marginBottom: 2,
              }}
            >
              CIIU {selected.code}
            </div>
            <div
              style={{
                fontSize: 14,
                color: INK,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selected.label}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, color: INK3, fontSize: 14 }}>
            Buscar código CIIU (ej: panadería, software, 4711)
          </div>
        )}
        <ChevronDown
          style={{
            width: 18,
            height: 18,
            color: INK2,
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s',
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
          }}
        >
          {/* Search input */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid rgba(0,0,0,0.06)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Search style={{ width: 15, height: 15, color: INK3, flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Escribe para buscar..."
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 14,
                color: INK,
                background: 'transparent',
                fontFamily: 'inherit',
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: INK3,
                  display: 'inline-flex',
                  padding: 2,
                }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          {actividad && (
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 11.5,
                color: INK2,
              }}
            >
              <span>
                {showAll
                  ? `Mostrando ${CIIU_CODES.length} códigos (todos)`
                  : `Filtrado por tu actividad (${totalForActivity} códigos)`}
              </span>
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: BRAND,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: 2,
                  fontFamily: 'inherit',
                }}
              >
                {showAll ? 'Solo mi actividad' : 'Ver todos'}
              </button>
            </div>
          )}

          {/* Results */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: INK3 }}>
                No encontramos códigos con ese término.
                <br />
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: BRAND,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 0 0',
                    fontFamily: 'inherit',
                  }}
                >
                  Buscar en todos los códigos
                </button>
              </div>
            ) : (
              results.map((c) => {
                const isSelected = c.code === value;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      onChange(c.code);
                      setOpen(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none',
                      background: isSelected ? 'oklch(0.43 0.14 155 / 0.08)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
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
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        padding: '3px 7px',
                        borderRadius: 5,
                        background: isSelected ? BRAND : '#f5f5f7',
                        color: isSelected ? '#fff' : INK2,
                        minWidth: 54,
                        textAlign: 'center',
                      }}
                    >
                      {c.code}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        color: INK,
                        lineHeight: 1.35,
                      }}
                    >
                      {c.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
