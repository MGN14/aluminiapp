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

// Helper to detect GMF/4x1000 transactions.
// Captura variantes con espacios variables: "4x1000", "4 x 1000", "4 x mil",
// "4 por mil", "4 por 1000", "cuatro por mil", "imp gobierno 4x1000",
// "gravamen movimientos financieros", "REV IMPTO GOBIERNO 4X1000", etc.
export function isGMFTransaction(description: string): boolean {
  if (!description) return false;
  const desc = description.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Regex que matchea "4 [espacios opcionales] x|por [espacios] (1000|mil)"
  if (/4\s*[x×*]\s*(1000|1\.000|mil)\b/.test(desc)) return true;
  if (/4\s*por\s*(1000|1\.000|mil)\b/.test(desc)) return true;
  if (/cuatro\s*(x|por)\s*(1000|mil)\b/.test(desc)) return true;

  return (
    desc.includes('gmf') ||
    desc.includes('gravamen movimiento') || // captura "movimiento" y "movimientos"
    desc.includes('impuesto gmf') ||
    desc.includes('imp gmf') ||
    desc.includes('impto gobierno') ||
    desc.includes('imp gobierno') ||
    desc.includes('imp. gobierno')
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
