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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FileText, Loader2, AlertCircle, Users, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link } from 'react-router-dom';

// ─── Persistencia de filtros en sessionStorage ───
// Chrome/Safari pueden "discard" pestañas inactivas para liberar memoria.
// Cuando el user vuelve, el componente se re-monta desde cero y los useState
// pierden su valor. Persistir en sessionStorage hace que los filtros, año y
// extracto seleccionados sobrevivan ese ciclo y no se sienta como "se reseteó".
// sessionStorage (no localStorage) → persiste por pestaña, se limpia al cerrar.
const FILTERS_STORAGE_KEY = 'aluminia_transactions_filters_v1';
const YEAR_STORAGE_KEY = 'aluminia_transactions_selected_year_v1';
const STATEMENT_STORAGE_KEY = 'aluminia_transactions_selected_statement_v1';

function loadFilters(): TransactionFilterState {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return defaultFilters;
    const parsed = JSON.parse(raw) as Omit<TransactionFilterState, 'dateFrom' | 'dateTo'> & {
      dateFrom?: string | null;
      dateTo?: string | null;
    };
    return {
      ...defaultFilters,
      ...parsed,
      dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      dateTo: parsed.dateTo ? new Date(parsed.dateTo) : undefined,
    };
  } catch {
    return defaultFilters;
  }
}

function saveFilters(filters: TransactionFilterState) {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
      ...filters,
      dateFrom: filters.dateFrom ? filters.dateFrom.toISOString() : null,
      dateTo: filters.dateTo ? filters.dateTo.toISOString() : null,
    }));
  } catch { /* private mode / quota */ }
}

function loadStringFromStorage(key: string, fallback: string): string {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStringToStorage(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}

interface Statement {
  id: string;
  file_name: string;
  display_name: string | null;
  transaction_count: number;
  statement_year: number | null;
  period_start: string | null;
  period_end: string | null;
  period_type: string | null;
}

function getEffectiveYear(stmt: Pick<Statement, 'statement_year' | 'period_start'>): number | null {
  if (typeof stmt.statement_year === 'number') return stmt.statement_year;
  if (stmt.period_start) {
    const d = new Date(stmt.period_start + 'T00:00:00');
    if (!isNaN(d.getTime())) return d.getFullYear();
  }
  return null;
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
  // Inicializamos desde sessionStorage para sobrevivir tab discard / re-mounts.
  const [selectedYear, setSelectedYear] = useState<string>(() => loadStringFromStorage(YEAR_STORAGE_KEY, String(currentYear)));
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>(() => loadStringFromStorage(STATEMENT_STORAGE_KEY, 'all'));
  const [loading, setLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [reteicaConfig, setReteicaConfig] = useState<ReteicaConfig>({ reteica_rate: 0 });
  const [filters, setFilters] = useState<TransactionFilterState>(() => loadFilters());
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

  // Persistir filtros, año y extracto cada vez que cambian (sobrevive a
  // re-mounts por tab discard).
  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { saveStringToStorage(YEAR_STORAGE_KEY, selectedYear); }, [selectedYear]);
  useEffect(() => { saveStringToStorage(STATEMENT_STORAGE_KEY, selectedStatement); }, [selectedStatement]);

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
  }, [selectedStatement, selectedYear, statements]);

  const fetchStatements = async () => {
    const { data } = await (supabase
      .from('bank_statements')
      .select('id, file_name, display_name, transaction_count, statement_year, period_start, period_end, period_type')
      .is('deleted_at', null)
      .order('statement_year', { ascending: false })
      .order('uploaded_at', { ascending: false }) as any);

    const nextStatements = (data || []) as Statement[];
    setStatements(nextStatements);

    const years = Array.from(
      new Set(
        nextStatements
          .map((stmt) => getEffectiveYear(stmt))
          .filter((year): year is number => typeof year === 'number')
      )
    ).sort((a, b) => b - a);

    if (!years.includes(currentYear)) {
      years.unshift(currentYear);
    }

    setAvailableYears(years);
    // No fallback: el año por defecto siempre es el actual aunque el extracto
    // subido cubra otro período (ej. un PDF que arranca en Dic del año pasado).
    // El usuario puede cambiarlo desde el selector si quiere ver años previos.
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setTransactions([]);
        setLoading(false);
        return;
      }

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
      } else {
        // Defensive: only show transactions tied to currently-active statements.
        // Protects against orphans when an older delete didn't cascade cleanly.
        const activeStatementIds = statements.map((s) => s.id);
        if (activeStatementIds.length === 0) {
          setTransactions([]);
          setLoading(false);
          return;
        }
        query = query.in('statement_id', activeStatementIds);
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
    return statements.filter((stmt) => getEffectiveYear(stmt) === year);
  }, [statements, selectedYear]);

  const groupedStatements = useMemo(() => {
    const monthly = filteredStatements.filter((s) => !s.period_type || s.period_type === 'monthly_close');
    const weekly = filteredStatements.filter((s) => s.period_type === 'weekly');
    return { monthly, weekly };
  }, [filteredStatements]);

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
      // Sort by signed amount: ingreso=credit (positivo), egreso=debit (negativo).
      // Antes hacíamos `debit || credit` que perdía la dirección — egreso 100
      // y ingreso 100 daban el mismo valor para ordenar.
      result.sort((a, b) => {
        const amountA = (a.credit ?? 0) - (a.debit ?? 0);
        const amountB = (b.credit ?? 0) - (b.debit ?? 0);
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
  }, [transactions, filters, pinnedPendingIds]);

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
                  onClick={() => handleFiltersChange({ ...filters, estado: 'pendientes' })}
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
                    {groupedStatements.monthly.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>📋 Cierres mensuales</SelectLabel>
                        {groupedStatements.monthly.map((stmt) => (
                          <SelectItem key={stmt.id} value={stmt.id}>
                            {stmt.display_name || stmt.file_name}
                            {stmt.transaction_count ? ` (${stmt.transaction_count})` : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {groupedStatements.weekly.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>📊 Movimientos semanales</SelectLabel>
                        {groupedStatements.weekly.map((stmt) => (
                          <SelectItem key={stmt.id} value={stmt.id}>
                            {stmt.display_name || stmt.file_name}
                            {stmt.transaction_count ? ` (${stmt.transaction_count})` : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
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
              <span>A quién le pagas:</span>
              <ResponsibleManagement onUpdate={() => { fetchResponsibles(); }} />
            </div>
          </div>

          {/* Reconciliation progress */}
          <div style={{
            background:'#fff', borderRadius:14,
            border:'1.5px solid rgba(0,0,0,0.07)',
            padding:'14px 20px', marginBottom:14,
            display:'flex', alignItems:'center', gap:20,
            boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <div>
              <div style={{fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',color:'#a1a1a6',marginBottom:4}}>Conciliadas</div>
              <div style={{fontSize:22,fontWeight:700,color:'oklch(0.43 0.14 155)'}}>{filterCounts.conciliadas}</div>
              <div style={{fontSize:11,color:'#a1a1a6'}}>de {filterCounts.total}</div>
            </div>
            <div style={{width:1,height:44,background:'rgba(0,0,0,0.07)'}}/>
            <div>
              <div style={{fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',color:'#a1a1a6',marginBottom:4}}>Pendientes</div>
              <div style={{fontSize:22,fontWeight:700,color:'oklch(0.65 0.15 65)'}}>{filterCounts.pendientes}</div>
            </div>
            <div style={{width:1,height:44,background:'rgba(0,0,0,0.07)'}}/>
            <div style={{flex:2}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6e6e73',marginBottom:6}}>
                <span>Progreso de conciliación</span>
                <span style={{fontWeight:700}}>{filterCounts.total > 0 ? Math.round((filterCounts.conciliadas / filterCounts.total) * 100) : 0}%</span>
              </div>
              <div style={{height:8,background:'#f5f5f7',borderRadius:99,overflow:'hidden'}}>
                <div style={{height:'100%',background:'oklch(0.43 0.14 155)',borderRadius:99,width:`${filterCounts.total > 0 ? Math.round((filterCounts.conciliadas / filterCounts.total) * 100) : 0}%`,transition:'width 0.6s cubic-bezier(0.16,1,0.3,1)'}}/>
              </div>
            </div>
          </div>

          {/* Filters */}
          <TransactionFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
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
                  <Table className="table-fixed w-full">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead
                          className="w-[72px] cursor-pointer select-none hover:bg-muted/70 transition-colors"
                          onClick={() => setFilters({ ...filters, sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
                          title="Click para invertir orden por fecha"
                        >
                          <span className="inline-flex items-center gap-1">
                            Fecha
                            {filters.sortOrder === 'asc'
                              ? <ArrowUp className="h-3 w-3 text-primary" />
                              : <ArrowDown className="h-3 w-3 text-primary" />}
                          </span>
                        </TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead
                          className="text-right w-[100px] cursor-pointer select-none hover:bg-muted/70 transition-colors"
                          onClick={() => {
                            const next = filters.amountSortOrder === null
                              ? 'desc'
                              : filters.amountSortOrder === 'desc'
                                ? 'asc'
                                : null;
                            setFilters({ ...filters, amountSortOrder: next });
                          }}
                          title="Click para ordenar por monto"
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Monto
                            {filters.amountSortOrder === 'desc' && <ArrowDown className="h-3 w-3 text-primary" />}
                            {filters.amountSortOrder === 'asc' && <ArrowUp className="h-3 w-3 text-primary" />}
                            {filters.amountSortOrder === null && <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />}
                          </span>
                        </TableHead>
                        <TableHead className="w-[80px]">Tipo</TableHead>
                        <TableHead className="w-[170px]">Categoría</TableHead>
                        <TableHead className="w-[170px]">Beneficiario</TableHead>
                        <TableHead className="w-[140px]">#Factura</TableHead>
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
