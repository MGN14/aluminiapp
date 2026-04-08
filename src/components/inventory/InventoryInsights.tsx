import { Brain, AlertCircle, Package, TrendingDown } from 'lucide-react';
import type { ProductWithMetrics, InventoryMetrics } from '@/hooks/useInventoryData';

interface Props {
  products: ProductWithMetrics[];
  metrics: InventoryMetrics;
}

function generateInsights(products: ProductWithMetrics[], metrics: InventoryMetrics) {
  const insights: { icon: typeof Brain; text: string; severity: 'danger' | 'warning' | 'info' }[] = [];

  const critical = products.filter(p => p.status === 'critico');
  if (critical.length > 0) {
    const names = critical.slice(0, 2).map(p => p.reference).join(', ');
    insights.push({
      icon: AlertCircle,
      text: `Te quedarías sin stock en menos de 15 días en ${critical.length} referencia(s): ${names}`,
      severity: 'danger',
    });
  }

  const excess = products.filter(p => p.status === 'exceso');
  if (excess.length > 0) {
    const stuckValue = excess.reduce((s, p) => s + p.stock_system * p.cost_per_unit, 0);
    insights.push({
      icon: Package,
      text: `Tienes $${stuckValue.toLocaleString('es-CO', { maximumFractionDigits: 0 })} en inventario sin movimiento. Capital detenido.`,
      severity: 'warning',
    });
  }

  if (metrics.totalDifference > 0) {
    insights.push({
      icon: TrendingDown,
      text: `Hay diferencias de inventario en ${products.filter(p => p.difference !== 0).length} productos. Revisa tu conteo físico.`,
      severity: 'info',
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: Brain,
      text: 'Tu inventario está bajo control. Sin alertas por ahora.',
      severity: 'info',
    });
  }

  return insights.slice(0, 3);
}

const severityStyles = {
  danger: 'border-destructive/30 bg-destructive/5',
  warning: 'border-warning/30 bg-warning/5',
  info: 'border-border bg-muted/30',
};

const iconStyles = {
  danger: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
};

export default function InventoryInsights({ products, metrics }: Props) {
  const insights = generateInsights(products, metrics);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-success/10 flex items-center justify-center">
          <Brain className="h-5 w-5 text-success" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Nico analizó tu inventario</h2>
          <p className="text-xs text-muted-foreground">Actualizado ahora</p>
        </div>
      </div>
      <div className="grid gap-3">
        {insights.map((insight, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 p-4 rounded-xl border ${severityStyles[insight.severity]} transition-all hover:shadow-sm`}
          >
            <insight.icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconStyles[insight.severity]}`} />
            <p className="text-sm leading-relaxed text-foreground">{insight.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
