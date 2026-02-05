import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, Calendar } from 'lucide-react';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface RetefuenteMonthlyCardProps {
  total: number;
  periodLabel: string;
  transactionCount: number;
}

export function RetefuenteMonthlyCard({ 
  total, 
  periodLabel, 
  transactionCount,
}: RetefuenteMonthlyCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Retefuente por Pagar
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
        {transactionCount > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {transactionCount} egreso{transactionCount !== 1 ? 's' : ''} con Retefuente
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RetefuenteYearlyCardProps {
  total: number;
  year: number;
  transactionCount: number;
}

export function RetefuenteYearlyCard({ 
  total, 
  year, 
  transactionCount 
}: RetefuenteYearlyCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Retefuente Acumulada
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
            {transactionCount} egreso{transactionCount !== 1 ? 's' : ''} con Retefuente
          </div>
        )}
      </CardContent>
    </Card>
  );
}
