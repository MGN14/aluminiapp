import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, Calendar } from 'lucide-react';

interface ReteicaCardsProps {
  monthlyTotal: number;
  yearlyTotal: number;
  monthLabel: string;
  year: number;
  transactionCount: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ReteicaMonthlyCard({ 
  total, 
  periodLabel, 
  transactionCount 
}: { 
  total: number; 
  periodLabel: string; 
  transactionCount: number;
}) {
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
        {transactionCount > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {transactionCount} transacción{transactionCount !== 1 ? 'es' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReteicaYearlyCard({ 
  total, 
  year, 
  transactionCount 
}: { 
  total: number; 
  year: number; 
  transactionCount: number;
}) {
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
            {transactionCount} transacción{transactionCount !== 1 ? 'es' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
