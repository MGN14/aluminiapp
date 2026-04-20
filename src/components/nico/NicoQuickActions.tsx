import { BarChart3, DollarSign, Receipt, TrendingUp, Package } from 'lucide-react';

const QUICK_ACTIONS = [
  { label: 'Analiza mis gastos', icon: BarChart3, query: 'Analiza mis gastos del último mes, identifica los más altos y si hay alguno fuera de lo normal.' },
  { label: '¿Quién me debe?', icon: DollarSign, query: '¿Quién me debe plata? Dame el detalle de mis cuentas por cobrar.' },
  { label: '¿Cuánto debo de IVA?', icon: Receipt, query: '¿Cuánto debo provisionar para IVA este período?' },
  { label: '¿Cómo va mi flujo?', icon: TrendingUp, query: '¿Cómo va mi flujo de caja este mes comparado con el anterior?' },
  { label: '¿Cómo va mi inventario?', icon: Package, query: '¿Cómo va mi inventario? ¿Hay diferencias entre el sistema y el conteo físico? ¿Dónde puedo estar perdiendo plata por inventario?' },
];

interface NicoQuickActionsProps {
  onSelect: (query: string) => void;
  disabled?: boolean;
}

export default function NicoQuickActions({ onSelect, disabled }: NicoQuickActionsProps) {
  const BRAND = 'oklch(0.43 0.14 155)';
  const BRAND_DIM = 'oklch(0.43 0.14 155 / 0.10)';
  const BRAND_BORDER = 'oklch(0.43 0.14 155 / 0.22)';
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 2,
        scrollbarWidth: 'none',
      }}
      className="scrollbar-none"
    >
      {QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            onClick={() => !disabled && onSelect(action.query)}
            disabled={disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 99,
              background: '#fff',
              border: '1.5px solid rgba(0,0,0,0.07)',
              fontSize: 12,
              fontWeight: 500,
              color: '#6e6e73',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
              flexShrink: 0,
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (disabled) return;
              e.currentTarget.style.border = `1.5px solid ${BRAND_BORDER}`;
              e.currentTarget.style.color = BRAND;
              e.currentTarget.style.background = BRAND_DIM;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.border = '1.5px solid rgba(0,0,0,0.07)';
              e.currentTarget.style.color = '#6e6e73';
              e.currentTarget.style.background = '#fff';
            }}
          >
            <Icon style={{ width: 14, height: 14 }} />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
