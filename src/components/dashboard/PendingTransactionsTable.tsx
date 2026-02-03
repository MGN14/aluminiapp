import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, PartyPopper, Clock } from 'lucide-react';
import { SearchableSelect } from '@/components/transactions/SearchableSelect';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Category } from '@/types/transaction';

interface PendingTransaction {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  category_id: string | null;
  category_name: string | null;
  responsible_id: string | null;
}

interface PendingTransactionsTableProps {
  transactions: PendingTransaction[];
  categories: Category[];
  periodLabel: string;
  onTransactionUpdated: () => void;
  onCategoryAdded?: () => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

export function PendingTransactionsTable({
  transactions,
  categories,
  periodLabel,
  onTransactionUpdated,
  onCategoryAdded,
}: PendingTransactionsTableProps) {
  const { user } = useAuth();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Filter only pending transactions (no responsible assigned)
  const pendingTransactions = useMemo(() => {
    return transactions
      .filter(tx => !tx.responsible_id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // ASC by date (oldest first)
  }, [transactions]);

  // Handle category change with optimistic update
  const handleCategoryChange = async (transactionId: string, categoryId: string | null) => {
    setUpdatingId(transactionId);
    
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ category_id: categoryId, category: null }) // Clear legacy category field
        .eq('id', transactionId);

      if (error) throw error;
      
      // Trigger refetch
      onTransactionUpdated();
    } catch (error) {
      console.error('Error updating category:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Handle adding new category
  const handleAddCategory = async (name: string): Promise<string | null> => {
    if (!user) return null;
    
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name, sort_order: categories.length })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error adding category:', error);
      return null;
    }
    
    onCategoryAdded?.();
    return data.id;
  };

  // Prepare category options for the dropdown
  const categoryOptions = useMemo(() => 
    categories
      .filter(c => c.active)
      .map(c => ({ value: c.id, label: c.name })),
    [categories]
  );

  const pendingCount = pendingTransactions.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Total Pendientes ({pendingCount})
        </CardTitle>
        <Link to="/transactions">
          <Button variant="outline" size="sm">
            Ver Todas <ExternalLink className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {pendingCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <PartyPopper className="h-12 w-12 text-success mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              ¡No tienes pendientes por conciliar! 🎉
            </h3>
            <p className="text-muted-foreground text-sm max-w-md">
              Todas tus transacciones tienen un responsable asignado. ¡Excelente trabajo!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Fecha</TableHead>
                  <TableHead className="min-w-[300px]">Descripción</TableHead>
                  <TableHead className="text-right w-32">Monto</TableHead>
                  <TableHead className="w-40">Categoría</TableHead>
                  <TableHead className="text-center w-24">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTransactions.map(tx => (
                  <TableRow key={tx.id}>
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
                      <SearchableSelect
                        options={categoryOptions}
                        value={tx.category_id}
                        onChange={(value) => handleCategoryChange(tx.id, value)}
                        placeholder="Sin categoría"
                        emptyLabel="Sin categoría"
                        addLabel="+ Agregar categoría"
                        onAdd={handleAddCategory}
                        triggerClassName="w-full h-7 text-xs"
                        disabled={updatingId === tx.id}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="destructive">
                        Pendiente
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-center py-4 text-muted-foreground text-sm">
              {periodLabel} •{' '}
              <Link to="/transactions" className="text-primary hover:underline">
                Ir a conciliar →
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
