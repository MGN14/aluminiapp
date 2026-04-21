import { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Wallet, Receipt, ArrowUpRight, ArrowDownRight, AlertCircle, Calendar, Info, CheckCircle, Sparkles, Package } from 'lucide-react';
import { useNico } from '@/hooks/useNicoContext';
import { useModuleContext } from '@/hooks/useModuleContext';
import nicoAvatar from '@/assets/nico-avatar.png';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getCuatrimestreForPeriod, isDIANPayment, MONTH_NAMES, Category, Responsible } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { UnifiedPeriodFilter, PeriodSelection, getPeriodDateRange } from '@/components/dashboard/UnifiedPeriodFilter';
import { PendingTransactionsTable } from '@/components/dashboard/PendingTransactionsTable';
import { IncomeVsExpenseChart } from '@/components/dashboard/IncomeVsExpenseChart';
import { ExpensesByCategoryChart } from '@/components/dashboard/ExpensesByCategoryChart';
import { BilledByMonthChart } from '@/components/dashboard/BilledByMonthChart';
import { BilledByClientMonthChart } from '@/components/dashboard/BilledByClientMonthChart';
import { GMFAccumulatedCard, isGMFTransaction } from '@/components/dashboard/GMFAccumulatedCard';
import InsightsMiniCards from '@/components/dashboard/InsightsMiniCards';
import { ReteicaMonthlyCard, ReteicaYearlyCard } from '@/components/dashboard/ReteicaCards';
import { RetefuenteMonthlyCard, RetefuenteYearlyCard } from '@/components/dashboard/RetefuenteCards';
import InvoiceSummaryCards, { InvoiceFiscalMetrics } from '@/components/dashboard/InvoiceSummaryCards';
import { useOperationalData, CxCCard, AnticiposCard, TopBuyersCard } from '@/components/dashboard/OperationalSummaryCards';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';
import InitialStateWarning from '@/components/dashboard/InitialStateWarning';
import FiscalProfileWarning from '@/components/dashboard/FiscalProfileWarning';
import FinancialHealthCard from '@/components/dashboard/FinancialHealthCard';
import UpcomingObligationsCard from '@/components/dashboard/UpcomingObligationsCard';
import EvasionGapCard from '@/components/dashboard/EvasionGapCard';
import { calculateEvasionGap } from '@/lib/evasionGap';
import TrialChecklist from '@/components/subscription/TrialChecklist';
import DashboardCustomizeModal from '@/components/dashboard/DashboardCustomizeModal';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useSubscription } from '@/hooks/useSubscription';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useDashboardCustomization, DashboardModule } from '@/hooks/useDashboardCustomization';

// ── Types ──────────────────────────────────────────────────
interface TransactionData {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  balance: number | null;
  category: string | null;
  category_id: string | null;
  category_name: string | null;
  responsible_id: string | null;
  invoice_id: string | null;
  notes: string | null;
  transaction_type: 'compra' | 'venta';
  type: 'ingreso' | 'egreso' | 'transferencia';
  has_iva: boolean;
  has_retefuente: boolean;
  has_reteica: boolean;
  iva_amount: number;
  iva_type: 'credito' | 'debito' | null;
  retefuente_amount: number;
  reteica_amount: number;
}

interface Metrics {
  saldoActual: number;
  totalIngresos: number;
  totalEgresos: number;
  pendingReconcile: number;
  transactionCount: number;
  cuatrimestreLabel: string;
  periodLabel: string;
}

interface ReteicaConfig {
  reteica_city: string | null;
  reteica_rate: number;
}

interface SalesInvoiceData {
  issue_date: string;
  total_amount: number;
  counterparty_name: string | null;
}

// ── Helpers ────────────────────────────────────────────────
function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Module wrapper with staggered entrance animation ──────
function DashboardBlock({ id, customization, children, index = 0 }: { id: DashboardModule; customization: ReturnType<typeof useDashboardCustomization>; children: ReactNode; index?: number }) {
  if (!customization.isVisible(id)) return null;
  return (
    <div
      className="animate-slide-up opacity-0 [animation-fill-mode:forwards]"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {children}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
function DashboardContent() {
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { checkSubscription, plan } = useSubscription();
  const { openNico } = useNico();
  const { isGerencial } = useModuleContext();
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [reteicaConfig, setReteicaConfig] = useState<ReteicaConfig>({ reteica_city: null, reteica_rate: 0 });
  const [invoiceMetrics, setInvoiceMetrics] = useState<InvoiceFiscalMetrics | null>(null);
  const [salesInvoices, setSalesInvoices] = useState<SalesInvoiceData[]>([]);
  const [cashMovements, setCashMovements] = useState<{ type: string; amount: number; date: string }[]>([]);
  // Anticipos arrastrados de periodos anteriores (initial_state_details sin
  // factura vinculada). Solo se carga en modo gerencial. Ver useEffect abajo.
  const [previousPeriodAdvances, setPreviousPeriodAdvances] = useState<number>(0);
  const customization = useDashboardCustomization();
  

  const now = new Date();
  const savedPeriodType = localStorage.getItem('dashboard_period_type') as PeriodSelection['type'] | null;
  const [periodSelection, setPeriodSelectionRaw] = useState<PeriodSelection>({
    type: savedPeriodType || 'year',
    month: now.getMonth() + 1,
    quarter: Math.ceil((now.getMonth() + 1) / 3),
    year: now.getFullYear(),
  });
  const setPeriodSelection = useCallback((sel: PeriodSelection) => {
    setPeriodSelectionRaw(sel);
    localStorage.setItem('dashboard_period_type', sel.type);
  }, []);
  const [periodInitialized, setPeriodInitialized] = useState(false);
  const operationalData = useOperationalData(periodSelection.year);

  // ── Checkout success ──
  useEffect(() => {
    const checkoutStatus = searchParams.get('checkout');
    const planUpgraded = searchParams.get('plan');
    if (checkoutStatus === 'success' && planUpgraded) {
      setShowSuccessMessage(true);
      checkSubscription();
      toast({ title: '¡Suscripción activada!', description: `Tu plan ${planUpgraded === 'empresarial' ? 'Empresarial' : 'Básico'} está activo.` });
      setSearchParams({});
      setTimeout(() => setShowSuccessMessage(false), 10000);
    }
  }, [searchParams, setSearchParams, checkSubscription, toast]);

  // ── Data fetchers (unchanged logic) ──
  const fetchReteicaConfig = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('reteica_city, reteica_rate').eq('user_id', user.id).maybeSingle();
      if (data) setReteicaConfig({ reteica_city: data.reteica_city, reteica_rate: data.reteica_rate || 0 });
    } catch (error) { console.error('Error fetching ReteICA config:', error); }
  }, []);

  const fetchSalesInvoices = useCallback(async () => {
    try {
      const yearStart = `${periodSelection.year}-01-01`;
      const yearEnd = `${periodSelection.year}-12-31`;
      const { data, error } = await supabase.from('invoices').select('issue_date, total_amount, counterparty_name').eq('status', 'confirmed').eq('type', 'venta').gte('issue_date', yearStart).lte('issue_date', yearEnd).order('issue_date', { ascending: true });
      if (error) throw error;
      setSalesInvoices((data as SalesInvoiceData[]) || []);
    } catch (error) { console.error('Error fetching sales invoices:', error); setSalesInvoices([]); }
  }, [periodSelection.year]);

  useEffect(() => { fetchSalesInvoices(); }, [fetchSalesInvoices]);

  // Fetch cash movements for gerencial mode
  const fetchCashMovements = useCallback(async () => {
    if (!isGerencial) {
      setCashMovements([]);
      return;
    }

    try {
      const yearStart = `${periodSelection.year}-01-01`;
      const yearEnd = `${periodSelection.year}-12-31`;
      const { data, error } = await supabase
        .from('cash_movements')
        .select('type, amount, date')
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .order('date', { ascending: true });

      if (error) throw error;
      setCashMovements((data as { type: string; amount: number; date: string }[]) || []);
    } catch (e) {
      console.error('Error fetching cash movements:', e);
      setCashMovements([]);
    }
  }, [isGerencial, periodSelection.year]);

  useEffect(() => { fetchCashMovements(); }, [fetchCashMovements]);

  // Anticipos del periodo anterior no conciliados = la misma fórmula que usa
  // /reports/advances (AdvancesReport.tsx). Son saldos históricos de plata
  // recibida en periodos anteriores que aún no fueron facturados. No están
  // dentro del extracto del periodo actual, por eso suman aparte al Real.
  const fetchPreviousPeriodAdvances = useCallback(async () => {
    if (!isGerencial) {
      setPreviousPeriodAdvances(0);
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Fuente canónica: columna agregada en initial_financial_state (se escribe
      // siempre al guardar en Ajustes). Fallback: sumar detalles sin invoice_id.
      // Mismo patrón que useEvasionGap + MÓDULO 11 del edge function.
      const [{ data: stateRow }, { data: detailRows, error }] = await Promise.all([
        supabase
          .from('initial_financial_state' as never)
          .select('anticipos_de_clientes')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('initial_state_details' as never)
          .select('amount, invoice_id')
          .eq('user_id', user.id)
          .eq('field_type', 'anticipos_de_clientes'),
      ]);
      if (error) throw error;
      const aggregated = Number((stateRow as { anticipos_de_clientes: number | null } | null)?.anticipos_de_clientes) || 0;
      const rows = (detailRows || []) as Array<{ amount: number | null; invoice_id: string | null }>;
      const detail = rows
        .filter(d => !d.invoice_id)
        .reduce((s, d) => s + (Number(d.amount) || 0), 0);
      setPreviousPeriodAdvances(aggregated > 0 ? aggregated : detail);
    } catch (e) {
      console.error('Error fetching previous period advances:', e);
      setPreviousPeriodAdvances(0);
    }
  }, [isGerencial]);

  useEffect(() => { fetchPreviousPeriodAdvances(); }, [fetchPreviousPeriodAdvances]);

  useEffect(() => { fetchTransactions(); fetchCategories(); fetchResponsibles(); fetchReteicaConfig(); initializePeriodFromData(); }, []);

  const initializePeriodFromData = async () => {
    try {
      const preferredType = savedPeriodType || 'year';
      const { data: statement } = await supabase.from('bank_statements').select('statement_month, statement_year').is('deleted_at', null).order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
      if (statement?.statement_month && statement?.statement_year) {
        setPeriodSelectionRaw({ type: preferredType, month: statement.statement_month, quarter: Math.ceil(statement.statement_month / 3), year: statement.statement_year });
        setPeriodInitialized(true);
        return;
      }
      const { data: transaction } = await supabase.from('transactions').select('date').is('deleted_at', null).order('date', { ascending: false }).limit(1).maybeSingle();
      if (transaction?.date) {
        const date = parseLocalDate(transaction.date);
        const month = date.getMonth() + 1;
        setPeriodSelectionRaw({ type: preferredType, month, quarter: Math.ceil(month / 3), year: date.getFullYear() });
      }
      setPeriodInitialized(true);
    } catch (error) { console.error('Error initializing period:', error); setPeriodInitialized(true); }
  };

  const { getPlanLimits } = useSubscription();
  const dashLimits = getPlanLimits();

  const fetchTransactions = useCallback(async () => {
    try {
      let query = supabase.from('transactions').select(`id, date, description, amount, balance, category, category_id, responsible_id, invoice_id, notes, transaction_type, type, has_iva, has_retefuente, has_reteica, iva_amount, iva_type, retefuente_amount, reteica_amount, categories!transactions_category_id_fkey(name)`).is('deleted_at', null).order('date', { ascending: true });
      if (dashLimits.historyMonths && dashLimits.historyMonths > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - dashLimits.historyMonths);
        query = query.gte('date', cutoff.toISOString().split('T')[0]);
      }
      const { data, error } = await query;
      if (error) throw error;
      const mappedData = (data || []).map(tx => ({ ...tx, category_name: tx.categories?.name || null, categories: undefined }));
      setTransactions(mappedData as TransactionData[]);
    } catch (error) { console.error('Error fetching transactions:', error); } finally { setLoading(false); }
  }, [dashLimits.historyMonths]);

  const fetchCategories = useCallback(async () => {
    try { const { data, error } = await supabase.from('categories').select('*').order('sort_order', { ascending: true }); if (error) throw error; setCategories((data as Category[]) || []); } catch (error) { console.error('Error fetching categories:', error); }
  }, []);

  const fetchResponsibles = useCallback(async () => {
    try { const { data, error } = await supabase.from('responsibles').select('*').order('name', { ascending: true }); if (error) throw error; setResponsibles((data as Responsible[]) || []); } catch (error) { console.error('Error fetching responsibles:', error); }
  }, []);

  // ── Computed (unchanged logic) ──
  const periodRange = useMemo(() => getPeriodDateRange(periodSelection), [periodSelection]);
  const cuatrimestre = useMemo(() => getCuatrimestreForPeriod(periodSelection.month, periodSelection.year), [periodSelection.month, periodSelection.year]);

  const periodTransactions = useMemo(() => transactions.filter(tx => { const d = parseLocalDate(tx.date); return d >= periodRange.start && d <= periodRange.end; }), [transactions, periodRange]);
  const cuatrimestreTransactions = useMemo(() => transactions.filter(tx => { const d = parseLocalDate(tx.date); return d >= cuatrimestre.start && d <= cuatrimestre.end; }), [transactions, cuatrimestre]);

  const gmfMetrics = useMemo(() => {
    const yearStart = new Date(periodSelection.year, 0, 1);
    const yearEnd = new Date(periodSelection.year, 11, 31, 23, 59, 59);
    const gmfTx = transactions.filter(tx => { const d = parseLocalDate(tx.date); return d >= yearStart && d <= yearEnd && isGMFTransaction(tx.description); });
    return { total: gmfTx.reduce((s, tx) => s + Math.abs(tx.amount ?? 0), 0), transactionCount: gmfTx.length, year: periodSelection.year };
  }, [transactions, periodSelection.year]);

  const metrics = useMemo((): Metrics => {
    if (transactions.length === 0 && cashMovements.length === 0) return { saldoActual: 0, totalIngresos: 0, totalEgresos: 0, pendingReconcile: 0, transactionCount: 0, cuatrimestreLabel: cuatrimestre.label, periodLabel: periodRange.label };
    const sortedByDate = [...periodTransactions].sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime());
    const saldoActual = sortedByDate[0]?.balance ?? 0;
    let totalIngresos = periodTransactions.filter(tx => (tx.amount ?? 0) > 0).reduce((s, tx) => s + (tx.amount ?? 0), 0);
    let totalEgresos = Math.abs(periodTransactions.filter(tx => (tx.amount ?? 0) < 0).reduce((s, tx) => s + (tx.amount ?? 0), 0));

    // In gerencial mode, add cash movements for the period
    if (isGerencial && cashMovements.length > 0) {
      const periodCash = cashMovements.filter(cm => {
        const d = parseLocalDate(cm.date);
        return d >= periodRange.start && d <= periodRange.end;
      });
      totalIngresos += periodCash.filter(cm => cm.type === 'ingreso').reduce((s, cm) => s + cm.amount, 0);
      totalEgresos += periodCash.filter(cm => cm.type === 'egreso').reduce((s, cm) => s + cm.amount, 0);
    }

    const pendingReconcile = periodTransactions.filter(tx => !tx.responsible_id).length;
    return { saldoActual, totalIngresos, totalEgresos, pendingReconcile, transactionCount: periodTransactions.length, cuatrimestreLabel: `Q${periodSelection.quarter} ${periodSelection.year}`, periodLabel: periodRange.label };
  }, [transactions, periodTransactions, cuatrimestre, periodRange, periodSelection, isGerencial, cashMovements]);

  // Ingresos separados por origen, para medir la brecha DIAN vs Real.
  //   Real = bankIncome + previousPeriodAdvances + cashIncome
  //   DIAN = invoicedAmount (suma de facturas de venta emitidas en el periodo)
  //
  // - bankIncome             = SUM(transactions.amount > 0) del periodo.
  // - previousPeriodAdvances = saldos históricos de anticipos no conciliados
  //                            (initial_state_details, no dependen del periodo).
  // - cashIncome             = SUM(cash_movements 'ingreso') del periodo.
  // - invoicedAmount         = SUM(invoices.total_amount type='venta') del periodo.
  const evasionResult = useMemo(() => {
    const bankIncome = periodTransactions
      .filter(tx => (tx.amount ?? 0) > 0)
      .reduce((s, tx) => s + (tx.amount ?? 0), 0);
    const cashIncome = cashMovements
      .filter(cm => {
        const d = parseLocalDate(cm.date);
        return d >= periodRange.start && d <= periodRange.end && cm.type === 'ingreso';
      })
      .reduce((s, cm) => s + Number(cm.amount || 0), 0);
    const invoicedAmount = salesInvoices
      .filter(inv => {
        const d = parseLocalDate(inv.issue_date);
        return d >= periodRange.start && d <= periodRange.end;
      })
      .reduce((s, inv) => s + (inv.total_amount || 0), 0);
    return calculateEvasionGap({
      bankIncome,
      previousPeriodAdvances,
      cashIncome,
      invoicedAmount,
    });
  }, [periodTransactions, cashMovements, periodRange, salesInvoices, previousPeriodAdvances]);

  // Meses efectivos del periodo seleccionado, para proyecciones en
  // EvasionDisclaimer. 'year' / 'quarter' / 'month' → mapeo simple.
  const evasionPeriodMonths = useMemo(() => {
    switch (periodSelection.type) {
      case 'month':
        return 1;
      case 'quarter':
        return 3;
      default:
        return 12;
    }
  }, [periodSelection.type]);

  const handleInvoiceMetrics = useCallback((m: InvoiceFiscalMetrics) => setInvoiceMetrics(m), []);

  const incomeVsExpenseData = useMemo(() => {
    const monthlyData: Record<string, { month: string; monthKey: string; ingresos: number; egresos: number }> = {};
    const dataToUse = periodSelection.type === 'month' ? transactions : periodTransactions;
    dataToUse.forEach(tx => {
      const date = parseLocalDate(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
      if (!monthlyData[monthKey]) monthlyData[monthKey] = { month: monthLabel, monthKey, ingresos: 0, egresos: 0 };
      const amount = tx.amount ?? 0;
      if (amount > 0) monthlyData[monthKey].ingresos += amount;
      else monthlyData[monthKey].egresos += Math.abs(amount);
    });
    return Object.entries(monthlyData).sort(([a], [b]) => a.localeCompare(b)).map(([, d]) => d).slice(-12);
  }, [transactions, periodTransactions, periodSelection.type]);

  const billedByMonthData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: MONTH_NAMES[i].slice(0, 3), monthKey: `${periodSelection.year}-${String(i + 1).padStart(2, '0')}`, total: 0 }));
    salesInvoices.forEach(inv => { const mi = parseLocalDate(inv.issue_date).getMonth(); if (mi >= 0 && mi < 12) months[mi].total += inv.total_amount || 0; });
    return months;
  }, [salesInvoices, periodSelection.year]);

  const billedByClientMonth = useMemo(() => {
    const totalsByClient = new Map<string, number>();
    salesInvoices.forEach(inv => { const c = inv.counterparty_name?.trim() || 'Sin nombre'; totalsByClient.set(c, (totalsByClient.get(c) || 0) + (inv.total_amount || 0)); });
    const topClients = Array.from(totalsByClient.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
    const data = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, string | number> = { month: MONTH_NAMES[i].slice(0, 3), monthKey: `${periodSelection.year}-${String(i + 1).padStart(2, '0')}` };
      topClients.forEach(c => { row[c] = 0; }); row.Otros = 0; return row;
    });
    let hasOthers = false;
    salesInvoices.forEach(inv => { const mi = parseLocalDate(inv.issue_date).getMonth(); if (mi < 0 || mi > 11) return; const c = inv.counterparty_name?.trim() || 'Sin nombre'; const isTop = topClients.includes(c); const key = isTop ? c : 'Otros'; if (!isTop) hasOthers = true; data[mi][key] = (Number(data[mi][key]) || 0) + (inv.total_amount || 0); });
    return { data, clientKeys: hasOthers ? [...topClients, 'Otros'] : topClients };
  }, [salesInvoices, periodSelection.year]);

  const expensesByCategoryData = useMemo(() => {
    const cat: Record<string, number> = {};
    periodTransactions.forEach(tx => { if ((tx.amount ?? 0) < 0) { const c = tx.category_name || tx.category || 'Sin categoría'; cat[c] = (cat[c] || 0) + Math.abs(tx.amount ?? 0); } });
    return Object.entries(cat).map(([category, value]) => ({ category, categoryKey: category, value })).sort((a, b) => b.value - a.value);
  }, [periodTransactions]);

  // ── Build ordered module map ──
  const moduleRenderers: Record<DashboardModule, (idx: number) => ReactNode> = {
    insights: (idx: number) => (
      <DashboardBlock id="insights" customization={customization} index={idx}>
        <InsightsMiniCards periodSelection={periodSelection} hasTransactions={transactions.length > 0} />
      </DashboardBlock>
    ),
    mainMetrics: (idx: number) => {
      const BRAND = 'oklch(0.43 0.14 155)';
      const DANGER = 'oklch(0.52 0.18 25)';
      const metricCardStyle = (i: number): React.CSSProperties => ({
        background: '#fff',
        borderRadius: 18,
        padding: '22px 24px',
        border: '1.5px solid rgba(0,0,0,0.07)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.2s, transform 0.2s',
        animation: `fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 0.05}s both`,
        opacity: 0,
      });
      const metricHover = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      };
      const metricLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
        e.currentTarget.style.transform = 'translateY(0)';
      };
      const metricLabelStyle: React.CSSProperties = {
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.8px',
        textTransform: 'uppercase',
        color: '#a1a1a6',
      };
      const metricValueStyle = (color: string): React.CSSProperties => ({
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: '-1px',
        color,
        marginTop: 10,
      });
      const iconWrapStyle = (tint: string): React.CSSProperties => ({
        width: 36,
        height: 36,
        borderRadius: 10,
        background: tint,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      });
      const neto = metrics.totalIngresos - metrics.totalEgresos;
      const isPositive = neto >= 0;
      return (
        <DashboardBlock id="mainMetrics" customization={customization} index={idx}>
          <div className="grid gap-5 md:grid-cols-3">
            <div style={metricCardStyle(0)} onMouseEnter={metricHover} onMouseLeave={metricLeave}>
              <div className="flex items-center justify-between">
                <p style={metricLabelStyle}>Ingresos</p>
                <div style={iconWrapStyle('oklch(0.43 0.14 155 / 0.10)')}>
                  <TrendingUp style={{ width: 16, height: 16, color: BRAND }} />
                </div>
              </div>
              <p style={metricValueStyle(BRAND)}>{formatCurrency(metrics.totalIngresos)}</p>
              <div className="flex items-center gap-1.5" style={{ marginTop: 10 }}>
                <ArrowUpRight style={{ width: 12, height: 12, color: BRAND }} />
                <span style={{ fontSize: 12, color: '#6e6e73' }}>{periodRange.label}</span>
              </div>
            </div>

            <div style={metricCardStyle(1)} onMouseEnter={metricHover} onMouseLeave={metricLeave}>
              <div className="flex items-center justify-between">
                <p style={metricLabelStyle}>Egresos</p>
                <div style={iconWrapStyle('oklch(0.52 0.18 25 / 0.08)')}>
                  <TrendingDown style={{ width: 16, height: 16, color: DANGER }} />
                </div>
              </div>
              <p style={metricValueStyle(DANGER)}>{formatCurrency(metrics.totalEgresos)}</p>
              <div className="flex items-center gap-1.5" style={{ marginTop: 10 }}>
                <ArrowDownRight style={{ width: 12, height: 12, color: DANGER }} />
                <span style={{ fontSize: 12, color: '#6e6e73' }}>{periodRange.label}</span>
              </div>
            </div>

            <div style={metricCardStyle(2)} onMouseEnter={metricHover} onMouseLeave={metricLeave}>
              <div className="flex items-center justify-between">
                <p style={metricLabelStyle}>Resultado Neto</p>
                <div
                  style={iconWrapStyle(
                    isPositive ? 'oklch(0.43 0.14 155 / 0.10)' : 'oklch(0.52 0.18 25 / 0.08)',
                  )}
                >
                  {isPositive ? (
                    <TrendingUp style={{ width: 16, height: 16, color: BRAND }} />
                  ) : (
                    <TrendingDown style={{ width: 16, height: 16, color: DANGER }} />
                  )}
                </div>
              </div>
              <p style={metricValueStyle(isPositive ? BRAND : DANGER)}>{formatCurrency(neto)}</p>
              <span style={{ fontSize: 12, color: '#6e6e73', marginTop: 10, display: 'block' }}>
                {periodRange.label}
              </span>
            </div>
          </div>
        </DashboardBlock>
      );
    },
    invoiceTax: (idx: number) => (
      <DashboardBlock id="invoiceTax" customization={customization} index={idx}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
          <InvoiceSummaryCards
            periodStart={periodRange.start}
            periodEnd={periodRange.end}
            periodLabel={periodRange.label}
            year={periodSelection.year}
            cuatrimestreStart={cuatrimestre.start}
            cuatrimestreEnd={cuatrimestre.end}
            onMetrics={handleInvoiceMetrics}
          />
          {/* IVA Neto */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {(invoiceMetrics?.ivaNeto ?? 0) >= 0 ? 'IVA por Pagar' : 'IVA a Favor'}
              </CardTitle>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${(invoiceMetrics?.ivaNeto ?? 0) >= 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
                <Receipt className={`h-4 w-4 ${(invoiceMetrics?.ivaNeto ?? 0) >= 0 ? 'text-destructive' : 'text-success'}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold ${(invoiceMetrics?.ivaNeto ?? 0) >= 0 ? 'text-destructive' : 'text-success'}`}>
                {formatCurrency(Math.abs(invoiceMetrics?.ivaNeto ?? 0))}
              </div>
              <div className="flex items-center text-xs text-muted-foreground mt-1 gap-1">
                <Calendar className="h-3 w-3" />
                {cuatrimestre.label}
              </div>
              <div className="flex items-start gap-1 mt-3 p-2 bg-muted/40 rounded-lg text-[10px] text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Estimado desde facturas confirmadas.</span>
              </div>
            </CardContent>
          </Card>
          {/* Impuesto de Renta Estimado */}
          {(() => {
            const dianIngresos = periodTransactions.filter(tx => (tx.amount ?? 0) > 0).reduce((s, tx) => s + (tx.amount ?? 0), 0);
            const dianEgresos = Math.abs(periodTransactions.filter(tx => (tx.amount ?? 0) < 0).reduce((s, tx) => s + (tx.amount ?? 0), 0));
            const dianNeto = dianIngresos - dianEgresos;
            const rentaEstimada = dianNeto > 0 ? dianNeto * 0.35 : 0;
            return (
              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Impuesto de Renta Estimado</CardTitle>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-accent/10">
                    <Receipt className="h-4 w-4 text-accent-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold text-foreground">
                    {formatCurrency(rentaEstimada)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1 gap-1">
                    <Calendar className="h-3 w-3" />
                    {periodRange.label}
                  </div>
                  <div className="flex items-start gap-1 mt-3 p-2 bg-muted/40 rounded-lg text-[10px] text-muted-foreground">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Aproximado. Verifica este valor con tu contador.</span>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
          {/* Pendientes Conciliar */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pendientes Conciliar</CardTitle>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${metrics.pendingReconcile > 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
                <AlertCircle className={`h-4 w-4 ${metrics.pendingReconcile > 0 ? 'text-destructive' : 'text-success'}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold ${metrics.pendingReconcile > 0 ? 'text-destructive' : 'text-success'}`}>{metrics.pendingReconcile}</div>
              <div className="text-xs text-muted-foreground mt-1">{periodRange.label}</div>
              <Link to="/transactions" className="text-xs hover:underline mt-1 inline-block text-primary">Ver transacciones →</Link>
            </CardContent>
          </Card>
          {/* Retefuente - siempre mes anterior */}
          <RetefuenteMonthlyCard total={invoiceMetrics?.retefuenteNextPayment ?? 0} periodLabel={`Pago correspondiente a ${invoiceMetrics?.nextPaymentMonthLabel ?? ''}`} transactionCount={0} />
          {/* RETEICA - siempre mes anterior, solo si > 0 */}
          {(invoiceMetrics?.reteicaNextPayment ?? 0) > 0 && <ReteicaMonthlyCard total={invoiceMetrics?.reteicaNextPayment ?? 0} periodLabel={`Pago correspondiente a ${invoiceMetrics?.nextPaymentMonthLabel ?? ''}`} transactionCount={0} />}
          {/* Retefuente Acumulada */}
          <RetefuenteYearlyCard total={invoiceMetrics?.retefuenteYear ?? 0} year={periodSelection.year} transactionCount={invoiceMetrics?.retefuenteYearCount ?? 0} />
          {/* Reteica Acumulada */}
          {(invoiceMetrics?.reteicaYear ?? 0) > 0 && <ReteicaYearlyCard total={invoiceMetrics?.reteicaYear ?? 0} year={periodSelection.year} transactionCount={invoiceMetrics?.reteicaYearCount ?? 0} />}
          <GMFAccumulatedCard total={gmfMetrics.total} year={gmfMetrics.year} transactionCount={gmfMetrics.transactionCount} />
          {/* CxC & Anticipos */}
          {!operationalData.loading && (
            <>
              <CxCCard totalCxC={operationalData.totalCxC} cxcCount={operationalData.cxcCount} year={periodSelection.year} />
              <AnticiposCard totalAnticipos={operationalData.totalAnticipos} anticiposCount={operationalData.anticiposCount} year={periodSelection.year} />
            </>
          )}
        </div>
      </DashboardBlock>
    ),
    operational: (idx: number) => (
      <DashboardBlock id="operational" customization={customization} index={idx}>
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Top 3 Clientes */}
          {!operationalData.loading && (
            <TopBuyersCard topBuyers={operationalData.topBuyers} totalComprasBase={operationalData.totalComprasBase} year={periodSelection.year} />
          )}
          {/* Top 3 Referencias Vendidas */}
          {invoiceMetrics && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-semibold text-foreground">Top 3 Referencias</CardTitle>
                  <span className="text-[10px] text-muted-foreground">(por base gravable)</span>
                </div>
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Package className="h-4 w-4 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                {(invoiceMetrics.topReferences?.length ?? 0) > 0 ? (
                  <>
                    <div className="space-y-3">
                      {invoiceMetrics.topReferences.map(([name, { total, qty }], index) => {
                        const pct = (invoiceMetrics.totalBaseRef ?? 0) > 0
                          ? ((total / invoiceMetrics.totalBaseRef) * 100).toFixed(0) : '0';
                        const RANK_COLORS = ['text-yellow-500', 'text-muted-foreground', 'text-amber-700'];
                        return (
                          <div key={name} className="flex items-center gap-3">
                            <span className={`font-bold text-lg w-6 text-center shrink-0 ${RANK_COLORS[index]}`}>{index + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground truncate">{name}</p>
                              <p className="text-[10px] text-muted-foreground">{qty} {qty === 1 ? 'unidad' : 'unidades'}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-semibold text-sm text-foreground whitespace-nowrap">{formatCurrency(total)}</p>
                              <p className="text-[10px] text-muted-foreground">{pct}% del total</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-4 pt-2 border-t border-border">{periodRange.label}</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                    <Package className="h-9 w-9 text-muted-foreground/25" />
                    <p className="text-sm font-medium text-muted-foreground">Sin ítems de referencia</p>
                    <p className="text-xs text-muted-foreground/70 max-w-[200px] leading-relaxed">
                      Esto se completa cuando tus facturas tienen ítems de detalle (código, descripción, cantidad)
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </DashboardBlock>
    ),
    chartsFlow: (idx: number) => (
      <DashboardBlock id="chartsFlow" customization={customization} index={idx}>
        <div className="grid gap-6 lg:grid-cols-2">
          <IncomeVsExpenseChart data={incomeVsExpenseData} periodLabel={periodRange.label} />
          <ExpensesByCategoryChart data={expensesByCategoryData} periodLabel={periodRange.label} />
        </div>
      </DashboardBlock>
    ),
    chartsBilling: (idx: number) => (
      <DashboardBlock id="chartsBilling" customization={customization} index={idx}>
        <div className="grid gap-6 lg:grid-cols-2">
          <BilledByMonthChart data={billedByMonthData} year={periodSelection.year} />
          <BilledByClientMonthChart data={billedByClientMonth.data} clientKeys={billedByClientMonth.clientKeys} year={periodSelection.year} />
        </div>
      </DashboardBlock>
    ),
    pendingTable: (idx: number) => (
      <DashboardBlock id="pendingTable" customization={customization} index={idx}>
        <PendingTransactionsTable
          transactions={transactions.filter(tx => parseLocalDate(tx.date).getFullYear() === periodSelection.year).map(tx => ({ id: tx.id, date: tx.date, description: tx.description, amount: tx.amount, category_id: tx.category_id, category_name: tx.category_name, responsible_id: tx.responsible_id, invoice_id: tx.invoice_id, notes: tx.notes, type: tx.type }))}
          categories={categories}
          responsibles={responsibles}
          periodLabel={`Año ${periodSelection.year}`}
          onTransactionUpdated={fetchTransactions}
          onCategoryAdded={fetchCategories}
          onResponsibleAdded={fetchResponsibles}
        />
      </DashboardBlock>
    ),
  };

  // ── Loading state ──
  if (loading || !periodInitialized) {
    return (
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div><Skeleton className="h-8 w-48 mb-2" /><Skeleton className="h-4 w-64" /></div>
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-6"><Skeleton className="h-4 w-20 mb-4" /><Skeleton className="h-10 w-40 mb-2" /><Skeleton className="h-3 w-24" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const orderedModules = customization.modules.sort((a, b) => a.order - b.order);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
        {/* ─── Header ─── */}
        <div
          className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between"
          style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both' }}
        >
          <div className="flex items-center gap-3.5">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 0 0 2px oklch(0.43 0.14 155 / 0.22)',
                flexShrink: 0,
              }}
            >
              <img
                src={nicoAvatar}
                alt="Nico"
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
              />
            </div>
            <div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: '-0.8px',
                  color: '#1d1d1f',
                }}
              >
                Tu negocio hoy
              </h1>
              <p style={{ fontSize: 13, color: '#6e6e73', marginTop: 2 }}>{periodRange.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DashboardCustomizeModal customization={customization} />
            <UnifiedPeriodFilter selection={periodSelection} onSelectionChange={setPeriodSelection} />
          </div>
        </div>

        {/* ─── Alerts ─── */}
        {showSuccessMessage && (
          <Alert className="border-success/30 bg-success/5 rounded-xl">
            <CheckCircle className="h-4 w-4 text-success" />
            <AlertTitle className="text-success">¡Suscripción activada!</AlertTitle>
            <AlertDescription>Tu plan está activo. Ahora puedes subir hasta {plan === 'empresarial' ? 'PDFs ilimitados' : '10 PDFs por mes'}.</AlertDescription>
          </Alert>
        )}

        <FiscalProfileWarning />
        <InitialStateWarning />
        <OnboardingGuide hasTransactions={transactions.length > 0} />
        <TrialChecklist />
        {isGerencial && (
          /* Card unificado: brecha + disclaimer (mid/high) en una sola tarjeta. */
          <EvasionGapCard evasion={evasionResult} periodMonths={evasionPeriodMonths} />
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <FinancialHealthCard year={periodSelection.year} month={periodSelection.month} />
          <UpcomingObligationsCard />
        </div>

        {metrics.transactionCount === 0 && transactions.length === 0 ? (
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-5">
                <Wallet className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No hay datos aún</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">Carga el extracto de tu banco para comenzar a ver tus métricas financieras.</p>
              <Link to="/statement-upload">
                <Button className="rounded-xl px-6">Subir mi primer extracto</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {metrics.transactionCount === 0 && (
              <Alert className="border-muted bg-muted/20 rounded-xl">
                <Calendar className="h-4 w-4" />
                <AlertDescription>No hay transacciones bancarias para {periodRange.label}. Las métricas de facturación se muestran si hay facturas confirmadas.</AlertDescription>
              </Alert>
            )}

            {/* Render modules in user-defined order */}
            {orderedModules.map((mod, idx) => (
              <div key={mod.id}>{moduleRenderers[mod.id](idx)}</div>
            ))}
          </div>
        )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <AppLayout>
      <DashboardContent />
    </AppLayout>
  );
}
