import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

interface Transaction {
  id: string;
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: string | null;
}

interface TransactionTableProps {
  transactions: Transaction[];
  onTransactionUpdate: () => void;
}

const CATEGORIES = [
  { value: 'ventas', label: 'Ventas' },
  { value: 'nomina', label: 'Nómina' },
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'impuestos', label: 'Impuestos' },
  { value: 'transferencias', label: 'Transferencias' },
  { value: 'otros', label: 'Otros' },
];

function formatCurrency(value: number | null) {
  if (value === null) return '-';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function TransactionTable({ transactions, onTransactionUpdate }: TransactionTableProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleCategoryChange = async (transactionId: string, category: string) => {
    setUpdatingId(transactionId);
    
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ category })
        .eq('id', transactionId);

      if (error) throw error;
      onTransactionUpdate();
    } catch (error) {
      console.error('Error updating category:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No hay transacciones para mostrar</p>
        <p className="text-sm mt-1">Sube un extracto PDF para comenzar</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[100px]">Fecha</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead className="text-right w-[130px]">Débito</TableHead>
            <TableHead className="text-right w-[130px]">Crédito</TableHead>
            <TableHead className="text-right w-[130px]">Saldo</TableHead>
            <TableHead className="w-[150px]">Categoría</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id} className="hover:bg-muted/30">
              <TableCell className="font-medium text-sm">
                {format(new Date(transaction.date), 'dd MMM', { locale: es })}
              </TableCell>
              <TableCell className="max-w-[300px] truncate text-sm">
                {transaction.description}
              </TableCell>
              <TableCell className="text-right">
                {transaction.debit && (
                  <span className="text-destructive font-medium text-sm">
                    {formatCurrency(transaction.debit)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {transaction.credit && (
                  <span className="text-success font-medium text-sm">
                    {formatCurrency(transaction.credit)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right text-sm font-medium">
                {formatCurrency(transaction.balance)}
              </TableCell>
              <TableCell>
                <Select
                  value={transaction.category || ''}
                  onValueChange={(value) => handleCategoryChange(transaction.id, value)}
                  disabled={updatingId === transaction.id}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
