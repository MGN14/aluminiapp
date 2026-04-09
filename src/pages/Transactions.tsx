import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import AppLayout from '@/components/layout/AppLayout';
import { Transaction, Category, Responsible } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import TransactionRow from '@/components/transactions/TransactionRow';
import TransactionDetailModal from '@/components/transactions/TransactionDetailModal';
import ResponsibleManagement from '@/components/management/ResponsibleManagement';
import CategoryManagement from '@/components/management/CategoryManagement';
import TransactionFilters, {
  TransactionFilterState,
  defaultFilters,
} from '@/components/transactions/TransactionFilters';
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
import { FileText, Loader2, AlertCircle, Users } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link } from 'react-router-dom';

interface Statement {
  id: string;
  file_name: string;
  display_name: string | null;
  transaction_count: number;
  statement_year: number | null;
}

interface ReteicaConfig {
  reteica_rate: number;
}

export default function Transactions() {
  const currentYear = new Date().getFullYear();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [reteicaConfig, setReteicaConfig] = useState<ReteicaConfig>({ reteica_rate: 0 });
  const [filters, setFilters] = useState<TransactionFilterState>(defaultFilters);
  // Track IDs that were pending when the "Pendientes" filter was activated,
  // so they stay visible even after receiving a beneficiario mid-session.
  const [pinnedPendingIds, setPinnedPendingIds] = useState<Set<string>>(new Set());

  // When the user switches TO "pendientes", snapshot the current pending IDs.
  // When they switch AWAY, clear the snapshot so re-entering recalculates.
  const handleFiltersChange = useCallback((newFilters: TransactionFilterState) => {
    if (newFilters.estado === 'pendientes' && filters.estado !== 'pendientes') {
      const ids = new Set(transactions.filter(tx => !tx.responsible_id).map(tx => tx.id));
      setPinnedPendingIds(ids);
    } else if (newFilters.estado !== 'pendientes' && filters.estado === 'pendientes') {
      setPinnedPendingIds(new Set());
    }
    setFilters(newFilters);
  }, [filters.estado, transactions]);

  useEffect(() => {
    fetchStatements();
    fetchCategories();
    fetchResponsibles();
    fetchReteicaConfig();
  }, []);

  const fetchReteicaConfig = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('profiles')
      .select('reteica_rate')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      setReteicaConfig({ reteica_rate: data.reteica_rate || 0 });
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [selectedStatement, selectedYear]);

  const fetchStatements = async () => {
    const { data } = await supabase
      .from('bank_statements')
      .select('id, file_name, display_name, transaction_count, statement_year')
      .is('deleted_at', null)
      .order('statement_year', { ascending: false })
      .order('uploaded_at', { ascending: false });

    const nextStatements = (data || []) as Statement[];
    setStatements(nextStatements);

    const years = Array.from(
      new Set(
        nextStatements
          .map((stmt) => stmt.statement_year)
          .filter((year): year is number => typeof year === 'number')
      )
    ).sort((a, b) => b - a);

    if (!years.includes(currentYear)) {
      years.unshift(currentYear);
    }

    setAvailableYears(years);
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

  const { getPlanLimits } = useSubscription();
  const limits = getPlanLimits();

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('transactions')
        .select('*')
        .is('deleted_at', null)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }); // Stable secondary sort

      if (selectedYear !== 'all') {
        const year = Number(selectedYear);
        query = query
          .gte('date', `${year}-01-01`)
          .lt('date', `${year + 1}-01-01`);
      }

      if (selectedStatement !== 'all') {
        query = query.eq('statement_id', selectedStatement);
      }

      // Apply historyMonths filter for plans with limited history
      if (limits.historyMonths && limits.historyMonths > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - limits.historyMonths);
        query = query.gte('date', cutoff.toISOString().split('T')[0]);
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

  // Optimistic local update: when a transaction changes (e.g., responsible assigned),
  // update state immediately so pending filters react instantly.
  const handleTransactionUpdated = useCallback((updated: Transaction) => {
    setTransactions(prev =>
      prev.map(tx => tx.id === updated.id ? { ...tx, ...updated } : tx)
    );
  }, []);

  // Counts for filter badges (computed from ALL transactions for the selected statement, not filtered)
  const filterCounts = useMemo(() => {
    const total = transactions.length;
    const pendientes = transactions.filter(tx => !tx.responsible_id).length;
    const conciliadas = total - pendientes;
    return { total, pendientes, conciliadas };
  }, [transactions]);

  const filteredStatements = useMemo(() => {
    if (selectedYear === 'all') return statements;
    const year = Number(selectedYear);
    return statements.filter((stmt) => stmt.statement_year === year);
  }, [statements, selectedYear]);

  useEffect(() => {
    if (selectedStatement === 'all') return;
    const existsInSelectedYear = filteredStatements.some((stmt) => stmt.id === selectedStatement);
    if (!existsInSelectedYear) {
      setSelectedStatement('all');
    }
  }, [filteredStatements, selectedStatement]);

  // Apply client-side filters and sorting
  const filteredTransactions = useMemo(() => {
    let result = [...transactions];

    // Estado filter
    if (filters.estado === 'pendientes') {
      result = result.filter(tx => !tx.responsible_id || pinnedPendingIds.has(tx.id));
    } else if (filters.estado === 'conciliadas') {
      result = result.filter(tx => !!tx.responsible_id);
    }

    // Tipo filter
    if (filters.tipo === 'ingresos') {
      result = result.filter(tx => tx.type === 'ingreso');
    } else if (filters.tipo === 'egresos') {
      result = result.filter(tx => tx.type === 'egreso');
    }

    // Category filter
    if (filters.categoryId) {
      result = result.filter(tx => tx.category_id === filters.categoryId);
    }

    // Responsible filter
    if (filters.responsibleId) {
      result = result.filter(tx => tx.responsible_id === filters.responsibleId);
    }

    // Date range filter
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter(tx => parseLocalDate(tx.date) >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(tx => parseLocalDate(tx.date) <= to);
    }

    // Sort logic
    if (filters.amountSortOrder) {
      // Sort by amount (debit or credit)
      result.sort((a, b) => {
        const amountA = a.debit || a.credit || 0;
        const amountB = b.debit || b.credit || 0;
        return filters.amountSortOrder === 'asc' ? amountA - amountB : amountB - amountA;
      });
    } else {
      // Default: sort by date with created_at tiebreaker
      result.sort((a, b) => {
        const dateA = parseLocalDate(a.date).getTime();
        const dateB = parseLocalDate(b.date).getTime();
        const dateDiff = filters.sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
        if (dateDiff !== 0) return dateDiff;
        const createdA = new Date(a.created_at).getTime();
        const createdB = new Date(b.created_at).getTime();
        return createdA - createdB;
      });
    }

    return result;
  }, [transactions, filters]);

  return (
    <AppLayout>
      <TooltipProvider>
        <div className="max-w-full mx-auto space-y-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Transacciones</h1>
              <p className="text-muted-foreground">
                Edita y clasifica tus movimientos bancarios
              </p>
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
              {/* Pending reconciliation counter */}
              {filterCounts.pendientes > 0 && (
                <Badge 
                  variant="outline" 
                  className="flex items-center gap-1.5 text-destructive border-destructive cursor-pointer hover:bg-destructive/10"
                  onClick={() => setFilters(f => ({ ...f, estado: 'pendientes' }))}
                >
                  <AlertCircle className="h-3 w-3" />
                  <span>{filterCounts.pendientes} sin conciliar</span>
                </Badge>
              )}
              
              {filterCounts.pendientes === 0 && filterCounts.total > 0 && (
                <Badge 
                  variant="outline" 
                  className="flex items-center gap-1.5 text-success border-success"
                >
                  <Users className="h-3 w-3" />
                  <span>Todo conciliado</span>
                </Badge>
              )}
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Año:</span>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Año" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {availableYears.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Extracto:</span>
                <Select value={selectedStatement} onValueChange={setSelectedStatement}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Todos los extractos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los extractos</SelectItem>
                    {filteredStatements.map((stmt) => (
                      <SelectItem key={stmt.id} value={stmt.id}>
                        {stmt.display_name || stmt.file_name}
                        {stmt.transaction_count ? ` (${stmt.transaction_count})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Management buttons */}
          <div className="flex gap-4 items-center text-sm">
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Categorías:</span>
              <CategoryManagement onUpdate={() => { fetchCategories(); }} />
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Beneficiarios:</span>
              <ResponsibleManagement onUpdate={() => { fetchResponsibles(); }} />
            </div>
          </div>

          {/* Filters */}
          <TransactionFilters
            filters={filters}
            onFiltersChange={setFilters}
            counts={filterCounts}
            categories={categories}
            responsibles={responsibles}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Movimientos ({filteredTransactions.length}
                {filteredTransactions.length !== filterCounts.total
                  ? ` de ${filterCounts.total}`
                  : ''})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-accent" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay transacciones</p>
                  <p className="text-sm mt-1">
                    <Link to="/statement-upload" className="text-primary hover:underline">
                      Sube un extracto
                    </Link> para comenzar
                  </p>
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay transacciones con estos filtros</p>
                  <p className="text-sm mt-1">
                    Prueba cambiando los filtros activos
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-[80px]">Fecha</TableHead>
                        <TableHead className="min-w-[300px]">Descripción</TableHead>
                        <TableHead className="text-right w-[110px]">Monto</TableHead>
                        <TableHead className="w-[110px]">Tipo</TableHead>
                        <TableHead className="w-[140px]">Categoría</TableHead>
                        <TableHead className="w-[140px]">Beneficiario</TableHead>
                        <TableHead className="w-[160px]">#Factura</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTransactions.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                          categories={categories}
                          responsibles={responsibles}
                          onViewDetail={setSelectedTransaction}
                          onCategoryAdded={fetchCategories}
                          onResponsibleAdded={fetchResponsibles}
                          onTransactionUpdated={handleTransactionUpdated}
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
