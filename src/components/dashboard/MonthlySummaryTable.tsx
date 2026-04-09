import { useMemo } from 'react';
import { parseLocalDate } from '@/lib/dateUtils';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText, Info } from 'lucide-react';
import { getCuatrimestreForPeriod, getMonthPeriod, MONTH_NAMES } from '@/types/transaction';

interface TransactionData {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  balance: number | null;
  category: string | null;
  responsible_id: string | null;
  transaction_type: 'compra' | 'venta';
  has_iva: boolean;
  has_retefuente: boolean;
  iva_amount: number;
  iva_type: 'credito' | 'debito' | null;
  retefuente_amount: number;
}
interface MonthlySummaryTableProps {
  transactions: TransactionData[];
  selectedMonth: number;
  selectedYear: number;
}
function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}
export function MonthlySummaryTable({
  transactions,
  selectedMonth,
  selectedYear
}: MonthlySummaryTableProps) {
  
  const monthPeriod = useMemo(() => getMonthPeriod(selectedMonth, selectedYear), [selectedMonth, selectedYear]);
  const cuatrimestre = useMemo(() => getCuatrimestreForPeriod(selectedMonth, selectedYear), [selectedMonth, selectedYear]);

  // Filter transactions for the selected month
  const monthTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= monthPeriod.start && txDate <= monthPeriod.end;
    });
  }, [transactions, monthPeriod]);

  // Filter transactions for the cuatrimestre (for IVA)
  const cuatrimestreTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
    });
  }, [transactions, cuatrimestre]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalIngresos = monthTransactions.filter(tx => (tx.amount ?? 0) > 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
    const totalEgresos = Math.abs(monthTransactions.filter(tx => (tx.amount ?? 0) < 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0));
    const netoMes = totalIngresos - totalEgresos;

    // IVA débito y crédito del cuatrimestre
    const ivaDebito = cuatrimestreTransactions
      .filter(tx => tx.iva_type === 'debito')
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);
    
    const ivaCredito = cuatrimestreTransactions
      .filter(tx => tx.iva_type === 'credito')
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);
    
    const ivaNeto = ivaDebito - ivaCredito;

    // Retefuente del mes (solo compras)
    const retefuenteMes = monthTransactions.reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);

    // Pendientes por conciliar
    const pendientesConciliar = monthTransactions.filter(tx => !tx.responsible_id).length;
    return {
      totalIngresos,
      totalEgresos,
      netoMes,
      ivaDebito,
      ivaCredito,
      ivaNeto,
      retefuenteMes,
      pendientesConciliar,
      totalTransacciones: monthTransactions.length
    };
  }, [monthTransactions, cuatrimestreTransactions]);

  return <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Resumen Mensual: {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div className="text-center p-4 bg-success/10 rounded-lg">
              <p className="text-sm text-muted-foreground">Ingresos</p>
              <p className="text-lg font-bold text-success">{formatCurrency(metrics.totalIngresos)}</p>
            </div>
            <div className="text-center p-4 bg-destructive/10 rounded-lg">
              <p className="text-sm text-muted-foreground">Egresos</p>
              <p className="text-lg font-bold text-destructive">{formatCurrency(metrics.totalEgresos)}</p>
            </div>
            <div className={`text-center p-4 rounded-lg ${metrics.netoMes >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
              <p className="text-sm text-muted-foreground">Neto</p>
              <p className={`text-lg font-bold ${metrics.netoMes >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(metrics.netoMes)}
              </p>
            </div>
            {/* IVA Neto */}
            <div className={`text-center p-4 rounded-lg ${metrics.ivaNeto >= 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
              <p className="text-sm text-muted-foreground">{metrics.ivaNeto >= 0 ? 'IVA por Pagar' : 'IVA a Favor'}</p>
              <p className={`text-lg font-bold ${metrics.ivaNeto >= 0 ? 'text-destructive' : 'text-success'}`}>
                {formatCurrency(Math.abs(metrics.ivaNeto))}
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <Info className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground">Estimado</span>
              </div>
            </div>
            <div className="text-center p-4 rounded-lg bg-accent/10">
              <p className="text-sm text-muted-foreground">Retefuente</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(metrics.retefuenteMes)}</p>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Pendientes</p>
              <p className={`text-lg font-bold ${metrics.pendientesConciliar > 0 ? 'text-destructive' : 'text-success'}`}>
                {metrics.pendientesConciliar}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Transacciones del Mes ({monthTransactions.length})</CardTitle>
          <Link to="/transactions">
            <Button variant="outline" size="sm">
              Ver Todas <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {monthTransactions.length === 0 ? <div className="text-center py-8 text-muted-foreground">
              No hay transacciones para este mes
            </div> : <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Fecha</TableHead>
                    <TableHead className="min-w-[300px]">Descripción</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20) // Show first 20
              .map(tx => <TableRow key={tx.id}>
                        <TableCell className="font-mono text-sm">
                          {new Date(tx.date).toLocaleDateString('es-CO', {
                    day: '2-digit',
                    month: 'short'
                  })}
                        </TableCell>
                        <TableCell className="max-w-[400px]">
                          <span className="block truncate" title={tx.description}>
                            {tx.description}
                          </span>
                        </TableCell>
                        <TableCell className={`text-right font-medium ${(tx.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {formatCurrency(tx.amount ?? 0)}
                        </TableCell>
                        <TableCell>
                          {tx.category ? <Badge variant="secondary" className="text-xs">
                              {tx.category}
                            </Badge> : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {tx.responsible_id ? <Badge variant="default" className="bg-success text-success-foreground">
                              Conciliado
                            </Badge> : <Badge variant="destructive">
                              Pendiente
                            </Badge>}
                        </TableCell>
                      </TableRow>)}
                </TableBody>
              </Table>
              {monthTransactions.length > 20 && <div className="text-center py-4 text-muted-foreground text-sm">
                  Mostrando 20 de {monthTransactions.length} transacciones.{' '}
                  <Link to="/transactions" className="text-accent hover:underline">
                    Ver todas →
                  </Link>
                </div>}
            </div>}
        </CardContent>
      </Card>
    </div>;
}