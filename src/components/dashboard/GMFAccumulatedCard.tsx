import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Landmark, Calendar } from 'lucide-react';

interface GMFAccumulatedCardProps {
  total: number;
  year: number;
  transactionCount: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

// Helper to detect GMF/4x1000 transactions
export function isGMFTransaction(description: string): boolean {
  const desc = description.toLowerCase();
  return (
    desc.includes('4x1000') ||
    desc.includes('gmf') ||
    desc.includes('impto gobierno 4x1000') ||
    desc.includes('gravamen movimientos financieros') ||
    desc.includes('impuesto gmf')
  );
}

export function GMFAccumulatedCard({ total, year, transactionCount }: GMFAccumulatedCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          4x1000 Acumulado
        </CardTitle>
        <div className="p-2 rounded-lg bg-accent/10">
          <Landmark className="h-4 w-4 text-accent" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold text-foreground">
          {formatCurrency(total)}
        </div>
        <div className="flex items-center text-xs text-muted-foreground mt-1">
          <Calendar className="h-3 w-3 mr-1" />
          Año {year} • {transactionCount} movimiento{transactionCount !== 1 ? 's' : ''}
        </div>
      </CardContent>
    </Card>
  );
}
