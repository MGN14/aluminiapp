import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, Calendar, MapPin, Percent } from 'lucide-react';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface ReteicaMonthlyCardProps {
  total: number;
  periodLabel: string;
  transactionCount: number;
  city?: string;
  rate?: number;
}

export function ReteicaMonthlyCard({ 
  total, 
  periodLabel, 
  transactionCount,
  city,
  rate,
}: ReteicaMonthlyCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          ReteICA por Pagar
        </CardTitle>
        <div className="p-2 rounded-lg bg-accent/10">
          <Receipt className="h-4 w-4 text-accent" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold text-foreground">
          {formatCurrency(total)}
        </div>
        <div className="flex items-center text-xs text-muted-foreground mt-1">
          <Calendar className="h-3 w-3 mr-1" />
          {periodLabel}
        </div>
        {/* City and rate info */}
        {(city || rate) && (
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            {city && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {city}
              </span>
            )}
            {rate !== undefined && rate > 0 && (
              <span className="flex items-center gap-1">
                <Percent className="h-3 w-3" />
                {(rate * 100).toFixed(3)}%
              </span>
            )}
          </div>
        )}
        {transactionCount > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {transactionCount} venta{transactionCount !== 1 ? 's' : ''} con ReteICA
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ReteicaYearlyCardProps {
  total: number;
  year: number;
  transactionCount: number;
}

export function ReteicaYearlyCard({ 
  total, 
  year, 
  transactionCount 
}: ReteicaYearlyCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          ReteICA Acumulado
        </CardTitle>
        <div className="p-2 rounded-lg bg-accent/10">
          <Receipt className="h-4 w-4 text-accent" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold text-foreground">
          {formatCurrency(total)}
        </div>
        <div className="flex items-center text-xs text-muted-foreground mt-1">
          <Calendar className="h-3 w-3 mr-1" />
          Año {year}
        </div>
        {transactionCount > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {transactionCount} venta{transactionCount !== 1 ? 's' : ''} con ReteICA
          </div>
        )}
      </CardContent>
    </Card>
  );
}
