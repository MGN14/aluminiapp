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
  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => !disabled && onSelect(action.query)}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/50 hover:bg-success/5 hover:border-success/40 text-xs text-muted-foreground hover:text-foreground transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <action.icon className="w-3.5 h-3.5" />
          {action.label}
        </button>
      ))}
    </div>
  );
}
