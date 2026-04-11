import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { AlertCircle, Link2, Filter, X } from 'lucide-react';
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

  // Filtros chiquitos y elegantes
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const txDate = parseLocalDate(tx.date);
      const amount = Math.abs(tx.amount ?? 0);

      if (dateFrom && isBefore(txDate, parseLocalDate(dateFrom)) && !isEqual(txDate, parseLocalDate(dateFrom))) return false;
      if (dateTo && isAfter(txDate, parseLocalDate(dateTo)) && !isEqual(txDate, parseLocalDate(dateTo))) return false;
      if (minAmount && amount < parseFloat(minAmount)) return false;
      if (maxAmount && amount > parseFloat(maxAmount)) return false;

      return true;
    });
  }, [transactions, dateFrom, dateTo, minAmount, maxAmount]);

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
        .eq('id', txId)
        .eq('user_id', user.id);

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
        {/* Filtros chiquitos y elegantes */}
        <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-3 w-3" />
              Filtros
              {hasActiveFilters && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </Button>
            
            {showFilters && (
              <>
                <div className="h-4 w-px bg-border mx-1" />
                
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-7 w-32 text-xs px-2"
                    placeholder="Desde"
                  />
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-7 w-32 text-xs px-2"
                    placeholder="Hasta"
                  />
                </div>

                <div className="h-4 w-px bg-border mx-1" />

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    className="h-7 w-28 text-xs px-2"
                    placeholder="Mín $"
                  />
                  <span className="text-muted-foreground text-xs">-</span>
                  <Input
                    type="number"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    className="h-7 w-28 text-xs px-2"
                    placeholder="Máx $"
                  />
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                    onClick={clearFilters}
                  >
                    <X className="h-3 w-3" />
                    Limpiar
                  </Button>
                )}
              </>
            )}
            
            {!showFilters && hasActiveFilters && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {dateFrom && <span className="bg-muted px-1.5 py-0.5 rounded">{format(parseLocalDate(dateFrom), 'dd/MM')}</span>}
                {dateFrom && dateTo && <span>-</span>}
                {dateTo && <span className="bg-muted px-1.5 py-0.5 rounded">{format(parseLocalDate(dateTo), 'dd/MM')}</span>}
                {(dateFrom || dateTo) && (minAmount || maxAmount) && <span className="mx-1">•</span>}
                {minAmount && <span className="bg-muted px-1.5 py-0.5 rounded">${parseFloat(minAmount).toLocaleString()}</span>}
                {minAmount && maxAmount && <span>-</span>}
                {maxAmount && <span className="bg-muted px-1.5 py-0.5 rounded">${parseFloat(maxAmount).toLocaleString()}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/80">
                <TableHead className="font-semibold">Fecha</TableHead>
                <TableHead className="font-semibold">Cliente</TableHead>
                <TableHead className="font-semibold min-w-[250px]">Descripción</TableHead>
                <TableHead className="font-semibold text-right">Monto</TableHead>
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
              ) : !transactions.length ? (
                <TableRow>
                  <TableCell colSpan={showReconcile ? 7 : 6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-muted-foreground">No hay anticipos para este periodo.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => {
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
