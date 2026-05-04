import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { AlertCircle, Link2, X, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO, isAfter, isBefore, isEqual } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface Invoice {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  total_amount: number;
  issue_date: string;
}

interface AdvancesTableProps {
  transactions: any[];
  statementsMap: Map<string, string>;
  respMap: Map<string, string>;
  invoices: Invoice[];
  isLoading: boolean;
  showReconcile: boolean;
}

type SortColumn = 'date' | 'amount' | null;
type SortDirection = 'asc' | 'desc';

export default function AdvancesTable({
  transactions,
  statementsMap,
  respMap,
  invoices,
  isLoading,
  showReconcile,
}: AdvancesTableProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reconciling, setReconciling] = useState<string | null>(null);

  // Filtros chiquitos y elegantes - siempre visibles
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Ordenamiento
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Alternar dirección si ya está ordenado por esta columna
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Nueva columna, iniciar con dirección por defecto
      setSortColumn(column);
      setSortDirection(column === 'date' ? 'desc' : 'desc');
    }
  };

  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-3 w-3 text-primary" />
      : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  const filteredAndSortedTransactions = useMemo(() => {
    // Primero filtrar
    let result = transactions.filter((tx) => {
      const txDate = parseLocalDate(tx.date);
      const amount = Math.abs(tx.amount ?? 0);

      if (dateFrom && isBefore(txDate, parseLocalDate(dateFrom)) && !isEqual(txDate, parseLocalDate(dateFrom))) return false;
      if (dateTo && isAfter(txDate, parseLocalDate(dateTo)) && !isEqual(txDate, parseLocalDate(dateTo))) return false;
      if (minAmount && amount < parseFloat(minAmount)) return false;
      if (maxAmount && amount > parseFloat(maxAmount)) return false;

      return true;
    });

    // Luego ordenar
    if (sortColumn === 'date') {
      result = result.sort((a, b) => {
        const dateA = parseLocalDate(a.date).getTime();
        const dateB = parseLocalDate(b.date).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      });
    } else if (sortColumn === 'amount') {
      result = result.sort((a, b) => {
        const amountA = Math.abs(a.amount ?? 0);
        const amountB = Math.abs(b.amount ?? 0);
        return sortDirection === 'asc' ? amountA - amountB : amountB - amountA;
      });
    }

    return result;
  }, [transactions, dateFrom, dateTo, minAmount, maxAmount, sortColumn, sortDirection]);

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
  };

  const hasActiveFilters = dateFrom || dateTo || minAmount || maxAmount;

  const handleReconcile = async (txId: string, invoiceId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ invoice_id: invoiceId })
        .eq('id', txId);

      if (error) throw error;
      toast.success('Anticipo conciliado con factura');
      queryClient.invalidateQueries({ queryKey: ['advances-report'] });
      setReconciling(null);
    } catch {
      toast.error('Error al conciliar');
    }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/80">
                <TableHead 
                  className="font-semibold cursor-pointer hover:bg-muted/50 transition-colors select-none"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center gap-1.5">
                    Fecha
                    {getSortIcon('date')}
                  </div>
                </TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                <TableHead className="font-semibold min-w-[250px]">Descripción</TableHead>
                <TableHead 
                  className="font-semibold text-right cursor-pointer hover:bg-muted/50 transition-colors select-none"
                  onClick={() => handleSort('amount')}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Monto
                    {getSortIcon('amount')}
                  </div>
                </TableHead>
                <TableHead className="font-semibold">Cuenta</TableHead>
                <TableHead className="font-semibold">Observaciones</TableHead>
                {showReconcile && <TableHead className="font-semibold">Conciliar</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={showReconcile ? 7 : 6} className="text-center py-12 text-muted-foreground">
                    Cargando datos...
                  </TableCell>
                </TableRow>
              ) : !filteredAndSortedTransactions.length ? (
                <TableRow>
                  <TableCell colSpan={showReconcile ? 7 : 6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-muted-foreground">
                        No hay anticipos para este periodo.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedTransactions.map((tx) => {
                  const clientName = tx.owner || (tx.responsible_id ? respMap.get(tx.responsible_id) : null) || 'Sin asignar';
                  const accountName = statementsMap.get(tx.statement_id) || '-';
                  const cleanNotes = (tx.notes || '')
                    .replace(/\[.*?\]/g, '')
                    .trim() || '-';

                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(parseLocalDate(tx.date), 'dd MMM yyyy', { locale: es })}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{clientName}</TableCell>
                      <TableCell className="text-sm truncate max-w-[300px]">{tx.description}</TableCell>
                      <TableCell className="text-right font-bold text-sm text-success">
                        {formatCurrency(Math.abs(tx.amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{accountName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{cleanNotes}</TableCell>
                      {showReconcile && (
                        <TableCell className="w-[180px]">
                          {reconciling === tx.id ? (
                            <Select onValueChange={(invoiceId) => handleReconcile(tx.id, invoiceId)}>
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue placeholder="Seleccionar factura" />
                              </SelectTrigger>
                              <SelectContent>
                                {invoices.map((inv) => (
                                  <SelectItem key={inv.id} value={inv.id}>
                                    <span className="text-xs">
                                      {inv.invoice_number} — {inv.counterparty_name || 'Sin nombre'} ({formatCurrency(inv.total_amount)})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => setReconciling(tx.id)}
                            >
                              <Link2 className="h-3 w-3" />
                              Vincular
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
