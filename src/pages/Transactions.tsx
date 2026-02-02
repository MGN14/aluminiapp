import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Transaction, Category, Responsible } from '@/types/transaction';
import TransactionRow from '@/components/transactions/TransactionRow';
import TransactionDetailModal from '@/components/transactions/TransactionDetailModal';
import ResponsibleManagement from '@/components/management/ResponsibleManagement';
import CategoryManagement from '@/components/management/CategoryManagement';
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
import { Badge } from '@/components/ui/badge';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TooltipProvider } from '@/components/ui/tooltip';

interface Statement {
  id: string;
  file_name: string;
}

export default function Transactions() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    fetchStatements();
    fetchCategories();
    fetchResponsibles();
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

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order');
    setCategories((data as Category[]) || []);
  };

  const fetchResponsibles = async () => {
    const { data } = await supabase
      .from('responsibles')
      .select('*')
      .order('name');
    setResponsibles((data as Responsible[]) || []);
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
      
      setTransactions((data as Transaction[]) || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTransaction = async (id: string, updates: Partial<Transaction>) => {
    try {
      const { error } = await supabase
        .from('transactions')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
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

  // Calculate pending reconciliation count (transactions without responsible)
  const pendingCount = transactions.filter(tx => !tx.responsible_id).length;

  return (
    <AppLayout>
      <TooltipProvider>
        <div className="max-w-full mx-auto space-y-6 px-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Transacciones</h1>
              <p className="text-muted-foreground">
                Edita y clasifica tus movimientos bancarios.
              </p>
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
              {pendingCount > 0 && (
                <Badge variant="outline" className="flex items-center gap-1 text-destructive border-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {pendingCount} sin conciliar
                </Badge>
              )}
              
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
          </div>

          {/* Management buttons */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>Responsables:</span>
              <ResponsibleManagement onUpdate={() => { fetchResponsibles(); fetchTransactions(); }} />
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>Categorías:</span>
              <CategoryManagement onUpdate={() => { fetchCategories(); fetchTransactions(); }} />
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
                        <TableHead className="w-[80px]">Fecha</TableHead>
                        <TableHead className="min-w-[250px]">Descripción</TableHead>
                        <TableHead className="text-right w-[110px]">Monto</TableHead>
                        <TableHead className="w-[130px]">Categoría</TableHead>
                        <TableHead className="w-[130px]">Responsable</TableHead>
                        <TableHead className="text-center w-[45px]">IVA</TableHead>
                        <TableHead className="text-right w-[80px]">$ IVA</TableHead>
                        <TableHead className="text-center w-[45px]">Rete</TableHead>
                        <TableHead className="text-right w-[80px]">$ Rete</TableHead>
                        <TableHead className="w-[120px]">Notas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                          categories={categories}
                          responsibles={responsibles}
                          onUpdate={handleUpdateTransaction}
                          onViewDetail={setSelectedTransaction}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <TransactionDetailModal
            transaction={selectedTransaction}
            open={!!selectedTransaction}
            onClose={() => setSelectedTransaction(null)}
          />
        </div>
      </TooltipProvider>
    </AppLayout>
  );
}
