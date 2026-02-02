import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Transaction } from '@/types/transaction';
import TransactionRow from '@/components/transactions/TransactionRow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
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
import { FileText, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Statement {
  id: string;
  file_name: string;
}

export default function Transactions() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatements();
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [selectedStatement]);

  const fetchStatements = async () => {
    const { data } = await supabase
      .from('bank_statements')
      .select('id, file_name')
      .order('uploaded_at', { ascending: false });
    setStatements(data || []);
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

      if (selectedStatement !== 'all') {
        query = query.eq('statement_id', selectedStatement);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Map the database response to our Transaction type
      const mappedTransactions: Transaction[] = (data || []).map(tx => ({
        ...tx,
        reconciled: tx.reconciled ?? false,
        has_vat: tx.has_vat ?? false,
        vat_percentage: tx.vat_percentage ?? 19,
        affects_dian: tx.affects_dian ?? false,
      }));
      
      setTransactions(mappedTransactions);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTransaction = async (id: string, updates: Partial<Transaction>) => {
    try {
      // Remove computed fields that shouldn't be sent to the database
      const { vat_amount, ...updateData } = updates as any;
      
      const { error } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      // Refresh to get computed vat_amount
      await fetchTransactions();
    } catch (error) {
      console.error('Error updating transaction:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar la transacción.',
        variant: 'destructive',
      });
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Transacciones</h1>
            <p className="text-muted-foreground">
              Edita y clasifica tus movimientos bancarios.
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Extracto:</span>
            <Select value={selectedStatement} onValueChange={setSelectedStatement}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Todos los extractos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los extractos</SelectItem>
                {statements.map((stmt) => (
                  <SelectItem key={stmt.id} value={stmt.id}>
                    {stmt.file_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Movimientos ({transactions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay transacciones</p>
                <p className="text-sm mt-1">Sube un extracto para comenzar</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[90px]">Fecha</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right w-[120px]">Monto</TableHead>
                      <TableHead className="w-[140px]">Categoría</TableHead>
                      <TableHead className="w-[120px]">Responsable</TableHead>
                      <TableHead className="text-center w-[60px]">Conc.</TableHead>
                      <TableHead className="text-center w-[50px]">IVA</TableHead>
                      <TableHead className="text-right w-[80px]">% IVA</TableHead>
                      <TableHead className="text-right w-[100px]">$ IVA</TableHead>
                      <TableHead className="w-[100px]">Retención</TableHead>
                      <TableHead className="text-center w-[60px]">DIAN</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((transaction) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        onUpdate={handleUpdateTransaction}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
