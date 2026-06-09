import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { AnimatedNumber } from '@/components/ui/animated-number';
import { cn } from '@/lib/utils';
import { normalizeDesc, isNoiseAmount } from '@/lib/descriptionMatch';
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

  // Snapshot inicial: si la página carga con filters.estado='pendientes'
  // (filtro persistido en localStorage), handleFiltersChange nunca se
  // dispara y pinnedPendingIds queda vacío — por eso al asignar un
  // responsable la fila salía del filtro al instante. Snapshotear acá
  // cuando lleguen las transactions resuelve el caso.
  const didInitialSnapshotRef = useRef(false);
  useEffect(() => {
    if (didInitialSnapshotRef.current) return;
    if (filters.estado !== 'pendientes') return;
    if (transactions.length === 0) return;
    didInitialSnapshotRef.current = true;
    const ids = new Set(transactions.filter(tx => !tx.responsible_id).map(tx => tx.id));
    setPinnedPendingIds(ids);
  }, [transactions, filters.estado]);

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
    // Orden alfabético: el sort_order existe pero los selectores quieren
    // alfabético para que el colaborador encuentre rápido.
    const { data } = await supabase
      .from('categories')
      .select('*')
      .order('name');
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

      // REGLA automática: ocultar movimientos cuyo monto es 0, redondea a 0, o no
      // es numérico (ajustes de interés de centavos, "FIN ESTADO CUENTA", etc.).
      // Se aplica a TODO extracto que se suba, para cualquier usuario — no es un
      // hide manual. Un solo chokepoint: afecta conteos, totales, dropdown y tabla.
      const clean = ((data as Transaction[]) || []).filter((tx) => !isNoiseAmount(tx.amount));
      setTransactions(clean);
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

          {/* Reconciliation progress — Apple glass card con números animados */}
          <div className="relative overflow-hidden rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white via-white to-slate-50/60 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-950 shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-5 py-4">
            {/* sheen sutil */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] to-transparent" />
            <div className="flex items-center gap-5 flex-wrap">
              <div className="min-w-[88px]">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">Conciliadas</div>
                <div className="text-[28px] leading-none font-bold tabular-nums" style={{ color: 'oklch(0.43 0.14 155)' }}>
                  <AnimatedNumber value={filterCounts.conciliadas} />
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">de {filterCounts.total}</div>
              </div>

              <div className="h-11 w-px bg-border/70" />

              <div className="min-w-[80px]">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-1">Pendientes</div>
                <div className="text-[28px] leading-none font-bold tabular-nums" style={{ color: filterCounts.pendientes > 0 ? 'oklch(0.65 0.15 65)' : 'oklch(0.43 0.14 155)' }}>
                  <AnimatedNumber value={filterCounts.pendientes} />
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1">{filterCounts.pendientes === 0 && filterCounts.total > 0 ? 'todo al día' : 'por asignar'}</div>
              </div>

              <div className="h-11 w-px bg-border/70" />

              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span className="text-muted-foreground/80 font-medium">Progreso de conciliación</span>
                  <span className="font-bold text-foreground tabular-nums text-sm">
                    <AnimatedNumber value={reconciledPct} />%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted/70 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${reconciledPct}%`,
                      background: 'linear-gradient(90deg, oklch(0.43 0.14 155), oklch(0.58 0.15 155))',
                      boxShadow: '0 0 8px oklch(0.43 0.14 155 / 0.35)',
                      transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)',
                    }}
                  />
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
