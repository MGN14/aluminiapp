import { useMemo, useState } from 'react';
import { Package, ArrowUpDown, Plus, Minus, Pencil, Search } from 'lucide-react';
import type { ProductWithMetrics, InventoryStatus } from '@/hooks/useInventoryData';

const STATUS_STYLES: Record<InventoryStatus, { label: string; dot: string; color: string; bg: string; border: string }> = {
  critico: {
    label: 'Crítico',
    dot:   'oklch(0.52 0.18 25)',
    color: 'oklch(0.52 0.18 25)',
    bg:    'oklch(0.58 0.20 25 / 0.10)',
    border:'oklch(0.58 0.20 25 / 0.22)',
  },
  alerta: {
    label: 'Alerta',
    dot:   'oklch(0.55 0.17 70)',
    color: 'oklch(0.55 0.17 70)',
    bg:    'oklch(0.70 0.17 70 / 0.12)',
    border:'oklch(0.70 0.17 70 / 0.25)',
  },
  sano: {
    label: 'Saludable',
    dot:   'oklch(0.43 0.14 155)',
    color: 'oklch(0.43 0.14 155)',
    bg:    'oklch(0.43 0.14 155 / 0.10)',
    border:'oklch(0.43 0.14 155 / 0.22)',
  },
  exceso: {
    label: 'Exceso',
    dot:   'oklch(0.50 0.17 305)',
    color: 'oklch(0.50 0.17 305)',
    bg:    'oklch(0.55 0.17 305 / 0.10)',
    border:'oklch(0.55 0.17 305 / 0.22)',
  },
};

type FilterKey = 'all' | 'critico' | 'exceso' | 'diff';

interface Props {
  products: ProductWithMetrics[];
  onAdjust: (product: ProductWithMetrics) => void;
  onAddMovement: (product: ProductWithMetrics, type: 'entrada' | 'salida') => void;
}

type SortKey = 'reference' | 'stock_system' | 'stock_physical' | 'difference' | 'days_of_inventory' | 'status' | 'cost_per_unit' | 'value';

const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const fmtCur = (n: number) =>
  `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

function daysCoverageColor(days: number): string {
  if (days < 15) return 'oklch(0.52 0.18 25)';      // red
  if (days < 30) return 'oklch(0.58 0.17 70)';      // amber
  if (days <= 80) return 'oklch(0.43 0.14 155)';    // green
  return 'oklch(0.50 0.17 305)';                    // purple (exceso)
}

const thStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#6e6e73',
  padding: '10px 14px',
  textAlign: 'left',
  borderBottom: '1px solid rgba(0,0,0,0.07)',
  background: '#f5f5f7',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#1d1d1f',
  padding: '12px 14px',
  borderBottom: '1px solid rgba(0,0,0,0.07)',
  verticalAlign: 'middle',
};

function SortableTh({ label, active, asc, onClick, align = 'left' }: { label: string; active: boolean; asc: boolean; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <th
      style={{ ...thStyle, cursor: 'pointer', textAlign: align, userSelect: 'none' }}
      onClick={onClick}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {label}
        <ArrowUpDown
          style={{
            width: 10,
            height: 10,
            color: active ? 'oklch(0.43 0.14 155)' : '#a1a1a6',
            transform: active && !asc ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </span>
    </th>
  );
}

function ActionButton({ onClick, title, color, bgHover, children }: { onClick: () => void; title: string; color: string; bgHover: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.07)',
        color,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s, border-color 0.15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = bgHover;
        e.currentTarget.style.borderColor = 'transparent';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#fff';
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)';
      }}
    >
      {children}
    </button>
  );
}

export default function InventoryTable({ products, onAdjust, onAddMovement }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (q && !(p.reference || '').toLowerCase().includes(q) && !(p.name || '').toLowerCase().includes(q)) return false;
      if (filter === 'critico' && p.status !== 'critico') return false;
      if (filter === 'exceso' && p.status !== 'exceso') return false;
      if (filter === 'diff' && p.difference === 0) return false;
      return true;
    });
  }, [products, search, filter]);

  const sorted = useMemo(() => {
    const statusOrder: Record<InventoryStatus, number> = { critico: 0, alerta: 1, sano: 2, exceso: 3 };
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'status') cmp = statusOrder[a.status] - statusOrder[b.status];
      else if (sortKey === 'reference') cmp = a.reference.localeCompare(b.reference);
      else if (sortKey === 'value') cmp = (a.stock_system * a.cost_per_unit) - (b.stock_system * b.cost_per_unit);
      else if (sortKey === 'stock_physical') {
        const aNull = a.stock_physical === null;
        const bNull = b.stock_physical === null;
        if (aNull && bNull) cmp = 0;
        else if (aNull) return 1;
        else if (bNull) return -1;
        else cmp = (a.stock_physical as number) - (b.stock_physical as number);
      }
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortAsc ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  if (!products.length) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '64px 24px',
          gap: 16,
          background: '#fff',
          border: '1px solid rgba(0,0,0,0.07)',
          borderRadius: 16,
        }}
      >
        <Package style={{ width: 40, height: 40, color: '#a1a1a6' }} />
        <p style={{ fontSize: 13, color: '#6e6e73', margin: 0 }}>Agrega tu primer producto para comenzar</p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.07)',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.07)',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>Inventario operativo</span>
          <span style={{ fontSize: 11, color: '#a1a1a6', marginLeft: 8 }}>
            {filtered.length} de {products.length}
          </span>
        </div>

        {/* Search */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            maxWidth: 260,
            minWidth: 180,
          }}
        >
          <Search
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 13,
              height: 13,
              color: '#a1a1a6',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Buscar referencia o nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: '#f5f5f7',
              border: '1px solid rgba(0,0,0,0.07)',
              borderRadius: 9,
              padding: '7px 10px 7px 30px',
              fontSize: 12,
              color: '#1d1d1f',
              fontFamily: 'inherit',
              outline: 'none',
              transition: 'border 0.15s',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#1d1d1f')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)')}
          />
        </div>

        {/* Segmented filter */}
        <div
          style={{
            display: 'inline-flex',
            background: '#f5f5f7',
            borderRadius: 9,
            padding: 2,
            gap: 1,
          }}
        >
          {([
            ['all', 'Todos'],
            ['critico', 'Críticos'],
            ['exceso', 'Exceso'],
            ['diff', 'Con diferencia'],
          ] as Array<[FilterKey, string]>).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              style={{
                border: 'none',
                background: filter === k ? '#fff' : 'transparent',
                boxShadow: filter === k ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                padding: '6px 10px',
                fontSize: 11.5,
                fontWeight: 550,
                color: filter === k ? '#1d1d1f' : '#6e6e73',
                cursor: 'pointer',
                borderRadius: 7,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
          <thead>
            <tr>
              <SortableTh label="Producto" active={sortKey === 'reference'} asc={sortAsc} onClick={() => toggleSort('reference')} />
              <SortableTh label="Siigo" active={sortKey === 'stock_system'} asc={sortAsc} onClick={() => toggleSort('stock_system')} align="right" />
              <SortableTh label="Físico" active={sortKey === 'stock_physical'} asc={sortAsc} onClick={() => toggleSort('stock_physical')} align="right" />
              <SortableTh label="Dif." active={sortKey === 'difference'} asc={sortAsc} onClick={() => toggleSort('difference')} align="right" />
              <SortableTh label="Costo unit." active={sortKey === 'cost_per_unit'} asc={sortAsc} onClick={() => toggleSort('cost_per_unit')} align="right" />
              <SortableTh label="Valor total" active={sortKey === 'value'} asc={sortAsc} onClick={() => toggleSort('value')} align="right" />
              <SortableTh label="Días cobertura" active={sortKey === 'days_of_inventory'} asc={sortAsc} onClick={() => toggleSort('days_of_inventory')} align="right" />
              <SortableTh label="Estado" active={sortKey === 'status'} asc={sortAsc} onClick={() => toggleSort('status')} />
              <th style={{ ...thStyle, textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const s = STATUS_STYLES[p.status];
              const hasPhysical = p.stock_physical !== null;
              const diff = p.difference;
              const value = p.stock_system * p.cost_per_unit;
              const days = p.days_of_inventory;
              const daysColor = daysCoverageColor(days);
              const daysPct = Math.min(100, (days / 90) * 100);
              const uomCode = (p.unit || '').toUpperCase().slice(0, 4) || '—';

              return (
                <tr
                  key={p.id}
                  style={{ transition: 'background 0.1s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f7')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Producto: thumb UoM + ref + name */}
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 7,
                          background: '#f5f5f7',
                          border: '1px solid rgba(0,0,0,0.07)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.02em',
                          color: '#6e6e73',
                          flexShrink: 0,
                        }}
                      >
                        {uomCode}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#1d1d1f',
                            lineHeight: 1.2,
                          }}
                        >
                          {p.reference}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#6e6e73',
                            marginTop: 2,
                            maxWidth: 240,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={p.name}
                        >
                          {p.name}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Siigo */}
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600 }}>
                    {fmt(p.stock_system)}
                  </td>

                  {/* Físico */}
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      color: hasPhysical ? '#6e6e73' : '#a1a1a6',
                    }}
                  >
                    {hasPhysical ? fmt(p.stock_physical as number) : '—'}
                  </td>

                  {/* Dif. */}
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      fontWeight: 600,
                      color:
                        !hasPhysical
                          ? '#a1a1a6'
                          : diff > 0
                          ? 'oklch(0.43 0.14 155)'
                          : diff < 0
                          ? 'oklch(0.52 0.18 25)'
                          : '#a1a1a6',
                    }}
                  >
                    {!hasPhysical ? '—' : diff === 0 ? '—' : diff > 0 ? `+${diff}` : `${diff}`}
                  </td>

                  {/* Costo unit. */}
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      color: '#6e6e73',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtCur(p.cost_per_unit)}
                  </td>

                  {/* Valor total */}
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtCur(value)}
                  </td>

                  {/* Días cobertura con barra */}
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: daysColor,
                          minWidth: 30,
                          textAlign: 'right',
                        }}
                        title={days >= 999 ? 'Sin ventas registradas en últimos 30 días' : `${days} días al ritmo actual`}
                      >
                        {days >= 999 ? '—' : `${days}d`}
                      </span>
                      <div
                        style={{
                          width: 48,
                          height: 4,
                          borderRadius: 99,
                          background: 'rgba(0,0,0,0.06)',
                          overflow: 'hidden',
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: `${days >= 999 ? 100 : daysPct}%`,
                            height: '100%',
                            background: daysColor,
                            borderRadius: 99,
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Estado */}
                  <td style={tdStyle}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 10px',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 600,
                        background: s.bg,
                        color: s.color,
                        border: `1px solid ${s.border}`,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: s.dot,
                          flexShrink: 0,
                        }}
                      />
                      {s.label}
                    </span>
                  </td>

                  {/* Acciones */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <ActionButton
                        onClick={() => onAddMovement(p, 'entrada')}
                        title="Entrada"
                        color="oklch(0.43 0.14 155)"
                        bgHover="oklch(0.43 0.14 155 / 0.10)"
                      >
                        <Plus style={{ width: 13, height: 13 }} />
                      </ActionButton>
                      <ActionButton
                        onClick={() => onAddMovement(p, 'salida')}
                        title="Salida"
                        color="oklch(0.52 0.18 25)"
                        bgHover="oklch(0.58 0.20 25 / 0.10)"
                      >
                        <Minus style={{ width: 13, height: 13 }} />
                      </ActionButton>
                      <ActionButton
                        onClick={() => onAdjust(p)}
                        title="Ajustar"
                        color="#6e6e73"
                        bgHover="#f5f5f7"
                      >
                        <Pencil style={{ width: 13, height: 13 }} />
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: '#a1a1a6', padding: '40px 20px' }}>
                  Ningún producto cumple con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
