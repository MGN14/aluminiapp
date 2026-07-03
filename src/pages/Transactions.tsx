import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Loader2, AlertCircle, Users, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, Check } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link } from 'react-router-dom';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { cn } from '@/lib/utils';
import { normalizeDesc, isNoiseAmount } from '@/lib/descriptionMatch';
import { computeCierreKpis, findUnmatchedTraspasos } from '@/lib/txBucket';
import { useColumnWidths, ColResizer } from '@/components/transactions/columnResize';

const copFmt = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// Anchos por defecto de las columnas de la tabla (px). El usuario los redimensiona
// arrastrando el borde; se guardan en localStorage.
const TX_COL_DEFAULTS: Record<string, number> = {
  fecha: 80, desc: 300, monto: 112, tipo: 92, categoria: 184, beneficiario: 184, factura: 152, naturaleza: 132,
};

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
  bank_name: string | null;
}

function getEffectiveYear(stmt: Pick<Statement, 'statement_year' | 'period_start'>): number | null {
  if (typeof stmt.statement_year === 'number') return stmt.statement_year;
  if (stmt.period_start) {
    const d = new Date(stmt.period_start + 'T00:00:00');
    if (!isNaN(d.getTime())) return d.getFullYear();
  }
  return null;
}

// Los 3 módulos del selector de extractos. Las keys matchean groupedStatements
// y el valor de filtro 'group:<key>' selecciona el módulo entero.
const STATEMENT_GROUPS = [
  { key: 'monthly', label: 'Cierres mensuales', emoji: '📋' },
  { key: 'weekly', label: 'Movimientos semanales', emoji: '📊' },
  { key: 'tarjeta', label: 'Tarjeta de crédito', emoji: '💳' },
] as const;

// ─── Query functions (React Query) ───
// La página vivía sobre useState + fetch en cada mount: navegar a otro módulo
// y volver re-fetcheaba TODO con spinner y "recalculaba" la conciliación.
// Con React Query el cache sobrevive al unmount: volver a la página pinta al
// instante desde cache y refetchea en background solo si los datos están stale.

async function queryStatements(): Promise<Statement[]> {
  const { data, error } = await (supabase
    .from('bank_statements')
    .select('id, file_name, display_name, transaction_count, statement_year, period_start, period_end, period_type, bank_name')
    .is('deleted_at', null)
    .order('statement_year', { ascending: false })
    .order('uploaded_at', { ascending: false }) as any);
  if (error) throw error;
  return (data || []) as Statement[];
}

async function queryCategories(): Promise<Category[]> {
  // Orden alfabético: el sort_order existe pero los selectores quieren
  // alfabético para que el colaborador encuentre rápido.
  const { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) throw error;
  return (data as Category[]) || [];
}

async function queryResponsibles(): Promise<Responsible[]> {
  const { data, error } = await supabase.from('responsibles').select('*').order('name');
  if (error) throw error;
  return (data as Responsible[]) || [];
}

async function queryTransactions(
  selectedYear: string,
  statementIds: string[],
  historyMonths: number | null | undefined,
): Promise<Transaction[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  // El filtro siempre es por lista de statement ids: un extracto puntual, un
  // módulo entero (mensuales/semanales/tarjeta) o todos los activos. También
  // protege contra huérfanos de deletes viejos que no cascadearon.
  if (statementIds.length === 0) return [];

  let query = supabase
    .from('transactions')
    .select('*')
    .is('deleted_at', null)
    .in('statement_id', statementIds)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true }); // Stable secondary sort

  if (selectedYear !== 'all') {
    const year = Number(selectedYear);
    query = query
      .gte('date', `${year}-01-01`)
      .lt('date', `${year + 1}-01-01`);
  }

  // Apply historyMonths filter for plans with limited history
  if (historyMonths && historyMonths > 0) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - historyMonths);
    query = query.gte('date', cutoff.toISOString().split('T')[0]);
  }

  const { data, error } = await query;
  if (error) throw error;

  // REGLA automática: ocultar movimientos cuyo monto es 0, redondea a 0, o no
  // es numérico (ajustes de interés de centavos, "FIN ESTADO CUENTA", etc.).
  // Se aplica a TODO extracto que se suba, para cualquier usuario — no es un
  // hide manual. Un solo chokepoint: afecta conteos, totales, dropdown y tabla.
  return ((data as Transaction[]) || []).filter((tx) => !isNoiseAmount(tx.amount));
}

export default function Transactions() {
  const currentYear = new Date().getFullYear();
  const queryClient = useQueryClient();

  // Inicializamos desde sessionStorage para sobrevivir tab discard / re-mounts.
  const [selectedYear, setSelectedYear] = useState<string>(() => loadStringFromStorage(YEAR_STORAGE_KEY, String(currentYear)));
  const [selectedStatement, setSelectedStatement] = useState<string>(() => loadStringFromStorage(STATEMENT_STORAGE_KEY, 'all'));
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [stmtPickerOpen, setStmtPickerOpen] = useState(false);
  const [filters, setFilters] = useState<TransactionFilterState>(() => loadFilters());
  // Track IDs that were pending when the "Pendientes" filter was activated,
  // so they stay visible even after receiving a beneficiario mid-session.
  const [pinnedPendingIds, setPinnedPendingIds] = useState<Set<string>>(new Set());

  const { getPlanLimits } = useSubscription();
  const limits = getPlanLimits();

  const statementsQuery = useQuery({
    queryKey: ['conciliacion', 'statements'],
    queryFn: queryStatements,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
  const statements = statementsQuery.data ?? [];

  const { data: categories = [] } = useQuery({
    queryKey: ['conciliacion', 'categories'],
    queryFn: queryCategories,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  const { data: responsibles = [] } = useQuery({
    queryKey: ['conciliacion', 'responsibles'],
    queryFn: queryResponsibles,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  // Extractos del año seleccionado, agrupados en los 3 módulos del selector.
  const filteredStatements = useMemo(() => {
    if (selectedYear === 'all') return statements;
    const year = Number(selectedYear);
    return statements.filter((stmt) => getEffectiveYear(stmt) === year);
  }, [statements, selectedYear]);

  const groupedStatements = useMemo(() => {
    // Tarjeta de crédito va en su propio grupo (el uploader la guarda con
    // bank_name "Tarjeta de crédito Bancolombia" y period_type weekly).
    const isTarjeta = (s: Statement) => (s.bank_name ?? '').toLowerCase().startsWith('tarjeta');
    const tarjeta = filteredStatements.filter(isTarjeta);
    const monthly = filteredStatements.filter((s) => !isTarjeta(s) && (!s.period_type || s.period_type === 'monthly_close'));
    const weekly = filteredStatements.filter((s) => !isTarjeta(s) && s.period_type === 'weekly');
    return { monthly, weekly, tarjeta };
  }, [filteredStatements]);

  // Resolución del filtro de extracto a ids concretos:
  //   'all' → todos los activos · 'group:X' → el módulo entero · uuid → ese extracto
  const selectedStatementIds = useMemo(() => {
    if (selectedStatement === 'all') return statements.map((s) => s.id);
    if (selectedStatement.startsWith('group:')) {
      const key = selectedStatement.slice('group:'.length) as keyof typeof groupedStatements;
      return (groupedStatements[key] ?? []).map((s) => s.id);
    }
    return [selectedStatement];
  }, [selectedStatement, statements, groupedStatements]);

  // Label del trigger del selector de extractos
  const statementFilterLabel = useMemo(() => {
    if (selectedStatement === 'all') return 'Todos los extractos';
    if (selectedStatement.startsWith('group:')) {
      const g = STATEMENT_GROUPS.find((g) => `group:${g.key}` === selectedStatement);
      return g ? `${g.emoji} ${g.label} — todos` : 'Todos los extractos';
    }
    const stmt = statements.find((s) => s.id === selectedStatement);
    return stmt ? (stmt.display_name || stmt.file_name) : 'Todos los extractos';
  }, [selectedStatement, statements]);

  // La lista de statement ids entra a la key: si se sube/borra un extracto,
  // la query de transacciones se refetchea con el set nuevo.
  const statementIdsKey = useMemo(() => selectedStatementIds.join('|'), [selectedStatementIds]);

  const txQueryKey = useMemo(
    () => ['conciliacion', 'transactions', selectedYear, selectedStatement, limits.historyMonths ?? 0, statementIdsKey] as const,
    [selectedYear, selectedStatement, limits.historyMonths, statementIdsKey],
  );

  const txQuery = useQuery({
    queryKey: txQueryKey,
    queryFn: () => queryTransactions(selectedYear, selectedStatementIds, limits.historyMonths),
    enabled: statementsQuery.isSuccess,
    // Al cambiar año/extracto mantenemos la lista anterior visible en vez de
    // flashear un spinner — se siente estable, no "recalculando".
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
  const transactions = txQuery.data ?? [];
  // Spinner solo en la PRIMERA carga (sin cache). Vueltas posteriores pintan
  // desde cache al instante mientras se revalida en background.
  const loading = statementsQuery.isPending || (txQuery.isPending && statementsQuery.isSuccess);

  const availableYears = useMemo(() => {
    const years = Array.from(
      new Set(
        statements
          .map((stmt) => getEffectiveYear(stmt))
          .filter((year): year is number => typeof year === 'number')
      )
    ).sort((a, b) => b - a);
    // No fallback: el año por defecto siempre es el actual aunque el extracto
    // subido cubra otro período (ej. un PDF que arranca en Dic del año pasado).
    // El usuario puede cambiarlo desde el selector si quiere ver años previos.
    if (!years.includes(currentYear)) {
      years.unshift(currentYear);
    }
    return years;
  }, [statements, currentYear]);

  const invalidateCategories = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['conciliacion', 'categories'] }),
    [queryClient],
  );
  const invalidateResponsibles = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['conciliacion', 'responsibles'] }),
    [queryClient],
  );

  // Al salir del filtro "pendientes" se limpia el pin — recién ahí desaparecen
  // las filas que fuiste conciliando. Mientras el filtro esté activo, NADA se va.
  const handleFiltersChange = useCallback((newFilters: TransactionFilterState) => {
    if (newFilters.estado !== 'pendientes' && filters.estado === 'pendientes') {
      setPinnedPendingIds(new Set());
    }
    setFilters(newFilters);
  }, [filters.estado]);

  // Pin ACUMULATIVO: mientras el filtro "pendientes" esté activo, toda fila que
  // en algún momento fue pendiente queda fijada — aunque le asignes categoría y
  // beneficiario podés seguir con factura y naturaleza sin que se esfume.
  // (El snapshot único al activar el filtro tenía huecos: si la data llegaba
  // después del snapshot, o venía de un refetch, la fila desaparecía al toque.)
  useEffect(() => {
    if (filters.estado !== 'pendientes') return;
    if (transactions.length === 0) return;
    setPinnedPendingIds(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const tx of transactions) {
        if (!tx.responsible_id && !next.has(tx.id)) {
          next.add(tx.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [transactions, filters.estado]);

  // Persistir filtros, año y extracto cada vez que cambian (sobrevive a
  // re-mounts por tab discard).
  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { saveStringToStorage(YEAR_STORAGE_KEY, selectedYear); }, [selectedYear]);
  useEffect(() => { saveStringToStorage(STATEMENT_STORAGE_KEY, selectedStatement); }, [selectedStatement]);

  // Optimistic local update: when a transaction changes (e.g., responsible assigned),
  // update the query cache immediately so pending filters react instantly.
  const handleTransactionUpdated = useCallback((updated: Transaction) => {
    queryClient.setQueryData<Transaction[]>(txQueryKey, (prev) =>
      prev?.map(tx => tx.id === updated.id ? { ...tx, ...updated } : tx)
    );
  }, [queryClient, txQueryKey]);

  // Counts for filter badges (computed from ALL transactions for the selected statement, not filtered)
  const filterCounts = useMemo(() => {
    const total = transactions.length;
    const pendientes = transactions.filter(tx => !tx.responsible_id).length;
    const conciliadas = total - pendientes;
    return { total, pendientes, conciliadas };
  }, [transactions]);

  // Descripciones distintas (parseadas) con conteo y suma — para el dropdown del
  // buscador por descripción. Sobre TODAS las transacciones del set actual.
  const descriptionOptions = useMemo(() => {
    // Agrupamos por descripción NORMALIZADA → las parecidas (difieren solo en
    // puntuación/espacios/acentos) se integran en una sola entrada. El label es
    // la variante más frecuente; variantCount indica cuántas formas se fusionaron.
    const groups = new Map<string, { variants: Map<string, number>; count: number; total: number }>();
    for (const tx of transactions) {
      const d = (tx.description ?? '').trim();
      if (!d) continue;
      const key = normalizeDesc(d);
      if (!key) continue;
      const g = groups.get(key) ?? { variants: new Map<string, number>(), count: 0, total: 0 };
      g.count += 1;
      g.total += Number(tx.amount ?? 0);
      g.variants.set(d, (g.variants.get(d) ?? 0) + 1);
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => {
        let rep = ''; let best = -1;
        for (const [desc, c] of g.variants) {
          if (c > best || (c === best && desc.length < rep.length)) { best = c; rep = desc; }
        }
        return { description: rep, count: g.count, total: g.total, variantCount: g.variants.size };
      })
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [transactions]);

  useEffect(() => {
    if (selectedStatement === 'all') return;
    if (!statementsQuery.isSuccess) return;
    // Grupo sin extractos en el año, o extracto puntual que no existe en el
    // año seleccionado → volver a "todos".
    if (selectedStatement.startsWith('group:')) {
      if (selectedStatementIds.length === 0) setSelectedStatement('all');
      return;
    }
    const existsInSelectedYear = filteredStatements.some((stmt) => stmt.id === selectedStatement);
    if (!existsInSelectedYear) {
      setSelectedStatement('all');
    }
  }, [filteredStatements, selectedStatement, selectedStatementIds, statementsQuery.isSuccess]);

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

    // Description search — normalizado (ignora puntuación/espacios/acentos) para
    // que al elegir una descripción agrupada matchee TODAS sus variantes.
    if ((filters.descSearch ?? '').trim()) {
      const q = normalizeDesc(filters.descSearch);
      if (q) result = result.filter(tx => normalizeDesc(tx.description).includes(q));
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

  // Totales monetarios del subconjunto filtrado — para "filtré por transporte,
  // ¿cuánto gasté?" sin sumar a mano una por una.
  // Usamos credit/debit directo (no amount con signo) para que sea consistente
  // con cómo el extracto reporta cada movimiento.
  const filteredTotals = useMemo(() => {
    let ingresos = 0;
    let egresos = 0;
    for (const tx of filteredTransactions) {
      ingresos += Number(tx.credit ?? 0);
      egresos += Number(tx.debit ?? 0);
    }
    return { ingresos, egresos, neto: ingresos - egresos };
  }, [filteredTransactions]);

  // Indica si hay filtros activos (más allá del default). Sirve para sólo
  // mostrar la suma cuando tiene sentido — sumar "todos los movimientos" del
  // statement ya está implícito en el extracto, no aporta.
  const hasActiveFilters = (
    filters.estado !== defaultFilters.estado ||
    filters.tipo !== defaultFilters.tipo ||
    !!filters.categoryId ||
    !!filters.responsibleId ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    (filters.descSearch ?? '').trim() !== ''
  );

  const reconciledPct = filterCounts.total > 0
    ? Math.round((filterCounts.conciliadas / filterCounts.total) * 100)
    : 0;

  // ── KPIs de CIERRE (no de etiquetado) ──────────────────────────────────
  // El valor del módulo no es llenar 554 etiquetas: es cerrar el loop entre
  // lo facturado y la plata del banco. Medimos (a) % de cobros de venta
  // conciliados contra cartera, (b) líneas sin explicar, (c) traspasos sin
  // pierna espejo en otra cuenta.
  const cierre = useMemo(() => {
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    return computeCierreKpis(transactions, nameById);
  }, [transactions, categories]);

  const traspasosSinEspejo = useMemo(
    () => findUnmatchedTraspasos(transactions),
    [transactions],
  );

  // Anchos de columna redimensionables (Excel-like), persistidos.
  const { widths: colWidths, startResize, total: colTotal } = useColumnWidths(TX_COL_DEFAULTS, 'aluminia_tx_colwidths_v1');

  return (
    <AppLayout>
      <TooltipProvider>
        <div className="max-w-full mx-auto space-y-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Conciliación bancaria</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
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
                {/* Panel de 3 módulos: mensuales / semanales / tarjeta, todos
                    visibles a la vez (el Select largo enterraba la tarjeta al
                    fondo). Click en el header del módulo = ver el módulo entero. */}
                <Popover open={stmtPickerOpen} onOpenChange={setStmtPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[240px] justify-between font-normal">
                      <span className="truncate">{statementFilterLabel}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[min(94vw,760px)] p-0">
                    <button
                      className={cn(
                        'w-full text-left px-4 py-2.5 text-sm font-medium border-b border-border hover:bg-muted/50 flex items-center gap-2',
                        selectedStatement === 'all' && 'text-primary'
                      )}
                      onClick={() => { setSelectedStatement('all'); setStmtPickerOpen(false); }}
                    >
                      {selectedStatement === 'all' && <Check className="h-3.5 w-3.5" />}
                      Todos los extractos
                    </button>
                    <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
                      {STATEMENT_GROUPS.map((g) => {
                        const list = groupedStatements[g.key];
                        const groupValue = `group:${g.key}`;
                        const groupTxCount = list.reduce((s, st) => s + (st.transaction_count ?? 0), 0);
                        return (
                          <div key={g.key} className="flex flex-col min-h-0">
                            <button
                              className={cn(
                                'text-left px-3 py-2.5 border-b border-border bg-muted/40 hover:bg-muted/70 transition-colors',
                                selectedStatement === groupValue && 'bg-primary/5'
                              )}
                              onClick={() => {
                                if (list.length === 0) return;
                                setSelectedStatement(groupValue);
                                setStmtPickerOpen(false);
                              }}
                              title={list.length > 0 ? `Ver todos los movimientos de ${g.label}` : undefined}
                            >
                              <span className={cn(
                                'text-xs font-semibold flex items-center gap-1.5',
                                selectedStatement === groupValue ? 'text-primary' : 'text-foreground'
                              )}>
                                {selectedStatement === groupValue && <Check className="h-3 w-3 shrink-0" />}
                                {g.emoji} {g.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {list.length === 0
                                  ? 'Sin extractos este año'
                                  : `${list.length} extracto${list.length > 1 ? 's' : ''} · ${groupTxCount} mov. — click para ver todo`}
                              </span>
                            </button>
                            <div className="overflow-y-auto max-h-[280px] p-1 space-y-0.5">
                              {list.map((stmt) => (
                                <button
                                  key={stmt.id}
                                  className={cn(
                                    'w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-muted/60 flex items-center gap-1.5',
                                    selectedStatement === stmt.id && 'bg-primary/10 text-primary font-medium'
                                  )}
                                  onClick={() => { setSelectedStatement(stmt.id); setStmtPickerOpen(false); }}
                                >
                                  {selectedStatement === stmt.id && <Check className="h-3 w-3 shrink-0" />}
                                  <span className="truncate flex-1">{stmt.display_name || stmt.file_name}</span>
                                  {stmt.transaction_count ? (
                                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                      {stmt.transaction_count}
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {/* Management buttons */}
          <div className="flex gap-4 items-center text-sm">
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Categorías:</span>
              <CategoryManagement onUpdate={invalidateCategories} />
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>A quién le pagas:</span>
              <ResponsibleManagement onUpdate={invalidateResponsibles} />
            </div>
          </div>

          {/* KPIs de CIERRE — el trabajo real: cerrar cartera contra banco,
              no llenar etiquetas fila por fila. */}
          <div className="relative overflow-hidden rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white via-white to-slate-50/60 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-950 shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-5 py-4">
            {/* sheen sutil */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] to-transparent" />
            <div className="flex items-center gap-5 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span className="text-muted-foreground/80 font-medium">Cobros de venta conciliados contra cartera</span>
                  <span className="font-bold text-foreground tabular-nums text-sm">
                    <AnimatedNumber value={cierre.cobrosPct} />%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted/70 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${cierre.cobrosPct}%`,
                      background: 'linear-gradient(90deg, oklch(0.43 0.14 155), oklch(0.58 0.15 155))',
                      boxShadow: '0 0 8px oklch(0.43 0.14 155 / 0.35)',
                      transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)',
                    }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                  {cierre.cobrosConciliados} de {cierre.cobrosVenta} cobros con factura enlazada o N/A explícito
                </div>
              </div>

              <div className="h-11 w-px bg-border/70" />

              <div className="min-w-[110px]">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">Sin explicar</div>
                <div className="text-[28px] leading-none font-bold tabular-nums" style={{ color: cierre.sinExplicar > 0 ? 'oklch(0.65 0.15 65)' : 'oklch(0.43 0.14 155)' }}>
                  <AnimatedNumber value={cierre.sinExplicar} />
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">
                  {cierre.sinExplicar === 0 ? 'todo justificado' : 'líneas sin categoría ni factura'}
                </div>
              </div>

              <div className="h-11 w-px bg-border/70" />

              <div
                className="min-w-[120px]"
                title={traspasosSinEspejo.length > 0
                  ? traspasosSinEspejo.slice(0, 6).map(t => `${t.date} · ${t.description ?? ''} (${Number(t.amount ?? 0).toLocaleString('es-CO')})`).join('\n')
                  : 'Todos los traspasos tienen su pierna espejo en otra cuenta'}
              >
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">Traspasos sin espejo</div>
                <div className="text-[28px] leading-none font-bold tabular-nums" style={{ color: traspasosSinEspejo.length > 0 ? 'oklch(0.52 0.18 25)' : 'oklch(0.43 0.14 155)' }}>
                  <AnimatedNumber value={traspasosSinEspejo.length} />
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">
                  {traspasosSinEspejo.length === 0 ? 'todos cruzados' : 'falta la contraparte'}
                </div>
              </div>

              <div className="h-11 w-px bg-border/70" />

              <div className="min-w-[100px]">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">Beneficiarios</div>
                <div className="text-[28px] leading-none font-bold tabular-nums text-foreground">
                  <AnimatedNumber value={reconciledPct} />%
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">
                  {filterCounts.pendientes > 0 ? `${filterCounts.pendientes} por asignar` : 'todo al día'}
                </div>
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
            descriptionOptions={descriptionOptions}
          />

          <Card className="rounded-2xl border-black/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Movimientos ({filteredTransactions.length}
                  {filteredTransactions.length !== filterCounts.total
                    ? ` de ${filterCounts.total}`
                    : ''})
                </CardTitle>
                {hasActiveFilters && filteredTransactions.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex flex-col items-end rounded-xl border border-success/20 bg-success/[0.06] px-3 py-1.5 min-w-[96px]">
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Ingresos</span>
                      <AnimatedNumber value={filteredTotals.ingresos} format={copFmt} className="font-bold text-success tabular-nums text-sm" />
                    </div>
                    <div className="flex flex-col items-end rounded-xl border border-destructive/20 bg-destructive/[0.06] px-3 py-1.5 min-w-[96px]">
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Egresos</span>
                      <AnimatedNumber value={filteredTotals.egresos} format={copFmt} className="font-bold text-destructive tabular-nums text-sm" />
                    </div>
                    <div className={cn(
                      'flex flex-col items-end rounded-xl border px-3 py-1.5 min-w-[96px]',
                      filteredTotals.neto >= 0 ? 'border-success/30 bg-success/[0.08]' : 'border-destructive/30 bg-destructive/[0.08]'
                    )}>
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Neto</span>
                      <AnimatedNumber value={filteredTotals.neto} format={copFmt} className={cn('font-bold tabular-nums text-sm', filteredTotals.neto >= 0 ? 'text-success' : 'text-destructive')} />
                    </div>
                  </div>
                )}
              </div>
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
                  <Table className="table-fixed" style={{ width: colTotal, minWidth: '100%' }}>
                    <colgroup>
                      <col style={{ width: colWidths.fecha }} />
                      <col style={{ width: colWidths.desc }} />
                      <col style={{ width: colWidths.monto }} />
                      <col style={{ width: colWidths.tipo }} />
                      <col style={{ width: colWidths.categoria }} />
                      <col style={{ width: colWidths.beneficiario }} />
                      <col style={{ width: colWidths.factura }} />
                      <col style={{ width: colWidths.naturaleza }} />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead
                          className="relative w-[72px] cursor-pointer select-none hover:bg-muted/70 transition-colors"
                          onClick={() => setFilters({ ...filters, sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
                          title="Click para invertir orden por fecha"
                        >
                          <span className="inline-flex items-center gap-1">
                            Fecha
                            {filters.sortOrder === 'asc'
                              ? <ArrowUp className="h-3 w-3 text-primary" />
                              : <ArrowDown className="h-3 w-3 text-primary" />}
                          </span>
                          <ColResizer onMouseDown={(e) => startResize('fecha', e)} />
                        </TableHead>
                        <TableHead className="relative">Descripción<ColResizer onMouseDown={(e) => startResize('desc', e)} /></TableHead>
                        <TableHead
                          className="relative text-right w-[100px] cursor-pointer select-none hover:bg-muted/70 transition-colors"
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
                          <ColResizer onMouseDown={(e) => startResize('monto', e)} />
                        </TableHead>
                        <TableHead className="relative w-[80px]">Tipo<ColResizer onMouseDown={(e) => startResize('tipo', e)} /></TableHead>
                        <TableHead className="relative w-[170px]">Categoría<ColResizer onMouseDown={(e) => startResize('categoria', e)} /></TableHead>
                        <TableHead className="relative w-[170px]">Beneficiario<ColResizer onMouseDown={(e) => startResize('beneficiario', e)} /></TableHead>
                        <TableHead className="relative w-[140px]">#Factura<ColResizer onMouseDown={(e) => startResize('factura', e)} /></TableHead>
                        <TableHead className="relative w-[120px]">Naturaleza<ColResizer onMouseDown={(e) => startResize('naturaleza', e)} /></TableHead>
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
                          onCategoryAdded={invalidateCategories}
                          onResponsibleAdded={invalidateResponsibles}
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
