import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Wallet, Flame, Receipt, Loader2, ArrowUpRight, ArrowDownRight, AlertCircle, Calendar, Info, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getCuatrimestreForPeriod, isDIANPayment, MONTH_NAMES, Category, Responsible } from '@/types/transaction';
import { UnifiedPeriodFilter, PeriodSelection, getPeriodDateRange } from '@/components/dashboard/UnifiedPeriodFilter';
import { PendingTransactionsTable } from '@/components/dashboard/PendingTransactionsTable';
import { IncomeVsExpenseChart } from '@/components/dashboard/IncomeVsExpenseChart';
import { ExpensesByCategoryChart } from '@/components/dashboard/ExpensesByCategoryChart';
import { GMFAccumulatedCard, isGMFTransaction } from '@/components/dashboard/GMFAccumulatedCard';
import { ReteicaMonthlyCard, ReteicaYearlyCard } from '@/components/dashboard/ReteicaCards';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import OnboardingGuide from '@/components/onboarding/OnboardingGuide';
import PlanStatusCard from '@/components/subscription/PlanStatusCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useSubscription } from '@/hooks/useSubscription';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';

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
  burnRate: number;
  ivaDebito: number;
  ivaCredito: number;
  ivaNeto: number;
  retefuentePorPagar: number;
  pendingReconcile: number;
  transactionCount: number;
  cuatrimestreLabel: string;
  periodLabel: string;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatCurrencyShort(value: number) {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { checkSubscription, plan } = useSubscription();
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  // Unified period selection state
  const now = new Date();
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>({
    type: 'month',
    month: now.getMonth() + 1,
    quarter: Math.ceil((now.getMonth() + 1) / 3),
    year: now.getFullYear(),
  });
  const [periodInitialized, setPeriodInitialized] = useState(false);

  // Handle checkout success
  useEffect(() => {
    const checkoutStatus = searchParams.get('checkout');
    const planUpgraded = searchParams.get('plan');
    
    if (checkoutStatus === 'success' && planUpgraded) {
      setShowSuccessMessage(true);
      checkSubscription(); // Refresh subscription status
      
      toast({
        title: '¡Suscripción activada!',
        description: `Tu plan ${planUpgraded === 'empresarial' ? 'Empresarial' : 'Básico'} está activo.`,
      });
      
      // Clean URL
      setSearchParams({});
      
      // Hide success message after 10 seconds
      setTimeout(() => setShowSuccessMessage(false), 10000);
    }
  }, [searchParams, setSearchParams, checkSubscription, toast]);

  useEffect(() => {
    fetchTransactions();
    fetchCategories();
    fetchResponsibles();
    initializePeriodFromData();
  }, []);

  const initializePeriodFromData = async () => {
    try {
      const { data: statement } = await supabase
        .from('bank_statements')
        .select('statement_month, statement_year')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .single();

      if (statement?.statement_month && statement?.statement_year) {
        setPeriodSelection({
          type: 'month',
          month: statement.statement_month,
          quarter: Math.ceil(statement.statement_month / 3),
          year: statement.statement_year,
        });
        setPeriodInitialized(true);
        return;
      }

      const { data: transaction } = await supabase
        .from('transactions')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (transaction?.date) {
        const date = new Date(transaction.date);
        const month = date.getMonth() + 1;
        setPeriodSelection({
          type: 'month',
          month,
          quarter: Math.ceil(month / 3),
          year: date.getFullYear(),
        });
      }
      setPeriodInitialized(true);
    } catch (error) {
      console.error('Error initializing period:', error);
      setPeriodInitialized(true);
    }
  };

  const fetchTransactions = useCallback(async () => {
    try {
      // Join with categories table to get category names
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id, date, description, amount, balance, category, category_id,
          responsible_id, transaction_type, type, has_iva, has_retefuente, has_reteica,
          iva_amount, iva_type, retefuente_amount, reteica_amount,
          categories!transactions_category_id_fkey(name)
        `)
        .is('deleted_at', null)
        .order('date', { ascending: true });

      if (error) throw error;
      
      // Map the joined data to include category_name
      const mappedData = (data || []).map(tx => ({
        ...tx,
        category_name: tx.categories?.name || null,
        categories: undefined, // Remove the nested object
      }));
      
      setTransactions(mappedData as TransactionData[]);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setCategories((data as Category[]) || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, []);

  const fetchResponsibles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('responsibles')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setResponsibles((data as Responsible[]) || []);
    } catch (error) {
      console.error('Error fetching responsibles:', error);
    }
  }, []);

  // Get date range based on period selection
  const periodRange = useMemo(() => getPeriodDateRange(periodSelection), [periodSelection]);
  
  // Cuatrimestre for IVA calculations (always based on the selected period's month/quarter)
  const cuatrimestre = useMemo(() => {
    return getCuatrimestreForPeriod(periodSelection.month, periodSelection.year);
  }, [periodSelection.month, periodSelection.year]);

  // Filter transactions for the selected period
  const periodTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= periodRange.start && txDate <= periodRange.end;
    });
  }, [transactions, periodRange]);

  // Filter transactions for the cuatrimestre (for IVA)
  const cuatrimestreTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
    });
  }, [transactions, cuatrimestre]);

  // Calculate GMF/4x1000 accumulated for the year
  const gmfMetrics = useMemo(() => {
    const yearStart = new Date(periodSelection.year, 0, 1);
    const yearEnd = new Date(periodSelection.year, 11, 31, 23, 59, 59);
    
    const gmfTransactions = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= yearStart && txDate <= yearEnd && isGMFTransaction(tx.description);
    });
    
    // Sum absolute values (GMF is always a cost, shown as positive)
    const total = gmfTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0);
    
    return {
      total,
      transactionCount: gmfTransactions.length,
      year: periodSelection.year,
    };
  }, [transactions, periodSelection.year]);

  // Calculate RETEICA metrics
  const reteicaMetrics = useMemo(() => {
    const yearStart = new Date(periodSelection.year, 0, 1);
    const yearEnd = new Date(periodSelection.year, 11, 31, 23, 59, 59);
    
    // Monthly RETEICA - from period transactions
    const monthlyTransactions = periodTransactions.filter(tx => tx.has_reteica);
    const monthlyTotal = monthlyTransactions.reduce((sum, tx) => sum + (tx.reteica_amount ?? 0), 0);
    
    // Yearly RETEICA - all transactions with RETEICA in the year
    const yearlyTransactions = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= yearStart && txDate <= yearEnd && tx.has_reteica;
    });
    const yearlyTotal = yearlyTransactions.reduce((sum, tx) => sum + (tx.reteica_amount ?? 0), 0);
    
    return {
      monthlyTotal,
      monthlyCount: monthlyTransactions.length,
      yearlyTotal,
      yearlyCount: yearlyTransactions.length,
    };
  }, [transactions, periodTransactions, periodSelection.year]);

  const metrics = useMemo((): Metrics => {
    if (transactions.length === 0) {
      return {
        saldoActual: 0,
        totalIngresos: 0,
        totalEgresos: 0,
        burnRate: 0,
        ivaDebito: 0,
        ivaCredito: 0,
        ivaNeto: 0,
        retefuentePorPagar: 0,
        pendingReconcile: 0,
        transactionCount: 0,
        cuatrimestreLabel: cuatrimestre.label,
        periodLabel: periodRange.label,
      };
    }

    // Get the last balance from the most recent transaction in the selected period
    const sortedByDate = [...periodTransactions].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const saldoActual = sortedByDate[0]?.balance ?? 0;

    // Total income and expenses for selected period
    const totalIngresos = periodTransactions
      .filter(tx => (tx.amount ?? 0) > 0)
      .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
    
    const totalEgresos = Math.abs(
      periodTransactions
        .filter(tx => (tx.amount ?? 0) < 0)
        .reduce((sum, tx) => sum + (tx.amount ?? 0), 0)
    );

    // Burn rate (average monthly expenses based on available data in cuatrimestre)
    const cuatrimestreExpenses = cuatrimestreTransactions.filter(tx => (tx.amount ?? 0) < 0);
    const monthsWithData = new Set(
      cuatrimestreExpenses.map(tx => {
        const d = new Date(tx.date);
        return `${d.getFullYear()}-${d.getMonth()}`;
      })
    ).size || 1;
    const burnRate = Math.abs(cuatrimestreExpenses.reduce((sum, tx) => sum + (tx.amount ?? 0), 0)) / monthsWithData;

    // IVA Débito (ventas) y Crédito (compras) - cuatrimestral
    const ivaDebito = cuatrimestreTransactions
      .filter(tx => tx.iva_type === 'debito')
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);
    
    const ivaCredito = cuatrimestreTransactions
      .filter(tx => tx.iva_type === 'credito')
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);

    // Detect DIAN payments and subtract from IVA
    const dianPayments = cuatrimestreTransactions.filter(tx => isDIANPayment(tx.description));
    const totalDianPayments = Math.abs(dianPayments.reduce((sum, tx) => sum + (tx.amount ?? 0), 0));

    // IVA Neto = Débito - Crédito - Pagos DIAN
    const ivaNeto = ivaDebito - ivaCredito - totalDianPayments;

    // Retefuente por pagar (period-based) - only from compras
    const retefuentePorPagar = periodTransactions.reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);

    // Pending reconciliation = transactions without responsible (for selected period)
    const pendingReconcile = periodTransactions.filter(tx => !tx.responsible_id).length;

    return {
      saldoActual,
      totalIngresos,
      totalEgresos,
      burnRate,
      ivaDebito,
      ivaCredito,
      ivaNeto,
      retefuentePorPagar,
      pendingReconcile,
      transactionCount: periodTransactions.length,
      cuatrimestreLabel: cuatrimestre.label,
      periodLabel: periodRange.label,
    };
  }, [transactions, periodTransactions, cuatrimestreTransactions, cuatrimestre, periodRange]);

  // Chart data: Income vs Expenses - grouped by month within the period
  const incomeVsExpenseData = useMemo(() => {
    const monthlyData: Record<string, {
      month: string;
      monthKey: string;
      ingresos: number;
      egresos: number;
    }> = {};

    // Use period transactions or all transactions depending on period type
    const dataToUse = periodSelection.type === 'month' 
      ? transactions // Show all months for comparison when viewing a single month
      : periodTransactions;

    dataToUse.forEach(tx => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('es-CO', {
        month: 'short',
        year: '2-digit'
      });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthLabel,
          monthKey,
          ingresos: 0,
          egresos: 0
        };
      }

      const amount = tx.amount ?? 0;
      if (amount > 0) {
        monthlyData[monthKey].ingresos += amount;
      } else {
        monthlyData[monthKey].egresos += Math.abs(amount);
      }
    });

    // Sort and limit to recent months for readability
    const sorted = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, data]) => data);

    // Show last 12 months max for clarity
    return sorted.slice(-12);
  }, [transactions, periodTransactions, periodSelection.type]);

  // Chart data: Expenses by category (selected period) - now using category_name from join
  const expensesByCategoryData = useMemo(() => {
    const categoryData: Record<string, number> = {};

    periodTransactions.forEach(tx => {
      if ((tx.amount ?? 0) < 0) {
        // Use category_name from join, fallback to legacy category, then "Sin categoría"
        const cat = tx.category_name || tx.category || 'Sin categoría';
        categoryData[cat] = (categoryData[cat] || 0) + Math.abs(tx.amount ?? 0);
      }
    });

    return Object.entries(categoryData)
      .map(([category, value]) => ({
        category,
        categoryKey: category,
        value
      }))
      .sort((a, b) => b.value - a.value);
  }, [periodTransactions]);

  // Chart data: IVA débito vs crédito accumulation over time (cuatrimestre)
  const ivaAccumulationData = useMemo(() => {
    let accumulatedDebito = 0;
    let accumulatedCredito = 0;
    const data: {
      date: string;
      debito: number;
      credito: number;
      neto: number;
    }[] = [];
    
    cuatrimestreTransactions
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach(tx => {
        if (tx.iva_type === 'debito') {
          accumulatedDebito += tx.iva_amount ?? 0;
        } else if (tx.iva_type === 'credito') {
          accumulatedCredito += tx.iva_amount ?? 0;
        }
        
        // Subtract DIAN payments from neto
        if (isDIANPayment(tx.description)) {
          accumulatedDebito -= Math.abs(tx.amount ?? 0);
        }
        
        const dateLabel = new Date(tx.date).toLocaleDateString('es-CO', {
          day: '2-digit',
          month: 'short'
        });
        
        data.push({
          date: dateLabel,
          debito: accumulatedDebito,
          credito: accumulatedCredito,
          neto: accumulatedDebito - accumulatedCredito
        });
      });

    return data;
  }, [cuatrimestreTransactions]);

  if (loading || !periodInitialized) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <Skeleton className="h-8 w-40 mb-2" />
              <Skeleton className="h-4 w-60" />
            </div>
            <Skeleton className="h-10 w-48" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-32 mb-2" />
                  <Skeleton className="h-3 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header with Unified Period Filter */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">
              Resumen financiero • {periodRange.label}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <UnifiedPeriodFilter 
              selection={periodSelection} 
              onSelectionChange={setPeriodSelection} 
            />
            <Link to="/statement-upload">
              <Button>Subir Extracto</Button>
            </Link>
          </div>
        </div>

        {/* Subscription Success Message */}
        {showSuccessMessage && (
          <Alert className="border-success bg-success/10 animate-fade-in">
            <CheckCircle className="h-4 w-4 text-success" />
            <AlertTitle className="text-success">¡Suscripción activada!</AlertTitle>
            <AlertDescription>
              Tu plan está activo. Ahora puedes subir hasta {plan === 'empresarial' ? 'PDFs ilimitados' : '10 PDFs por mes'}.
            </AlertDescription>
          </Alert>
        )}

        {/* Plan Status Card */}
        <PlanStatusCard />

        {/* Onboarding Guide for new users */}
        <OnboardingGuide hasTransactions={transactions.length > 0} />

        {metrics.transactionCount === 0 && transactions.length === 0 ? (
          <Card className="animate-fade-in">
            <CardContent className="py-12 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No hay datos aún
              </h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Sube tu primer extracto bancario de Bancolombia para comenzar a ver tus métricas financieras y organizar tus transacciones.
              </p>
              <Link to="/statement-upload">
                <Button>Subir mi primer extracto</Button>
              </Link>
            </CardContent>
          </Card>
        ) : metrics.transactionCount === 0 ? (
          <Card className="animate-fade-in">
            <CardContent className="py-12 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Sin transacciones en este periodo
              </h3>
              <p className="text-muted-foreground mb-6">
                No hay transacciones para {periodRange.label}. 
                Selecciona otro periodo o sube un extracto.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Main Metrics Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-fade-in">
              {/* Saldo Actual */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Saldo Final
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-accent/10">
                    <Wallet className="h-4 w-4 text-accent" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${metrics.saldoActual >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                    {formatCurrency(metrics.saldoActual)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {periodRange.label}
                  </div>
                </CardContent>
              </Card>

              {/* Total Ingresos */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Ingresos
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-success/10">
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">
                    {formatCurrency(metrics.totalIngresos)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <ArrowUpRight className="h-3 w-3 mr-1 text-success" />
                    {periodRange.label}
                  </div>
                </CardContent>
              </Card>

              {/* Total Egresos */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Egresos
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">
                    {formatCurrency(metrics.totalEgresos)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <ArrowDownRight className="h-3 w-3 mr-1 text-destructive" />
                    {periodRange.label}
                  </div>
                </CardContent>
              </Card>

              {/* Burn Rate */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Burn Rate
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <Flame className="h-4 w-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    {formatCurrency(metrics.burnRate)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Promedio mensual ({metrics.cuatrimestreLabel})
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tax Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-fade-in">

              {/* IVA Neto (Por Pagar / A Favor) - Always visible with disclaimer */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {metrics.ivaNeto >= 0 ? 'IVA por Pagar' : 'Saldo a Favor'}
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${metrics.ivaNeto >= 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
                    <Receipt className={`h-4 w-4 ${metrics.ivaNeto >= 0 ? 'text-destructive' : 'text-success'}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-xl font-bold ${metrics.ivaNeto >= 0 ? 'text-destructive' : 'text-success'}`}>
                    {formatCurrency(Math.abs(metrics.ivaNeto))}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3 mr-1" />
                    {metrics.cuatrimestreLabel}
                  </div>
                  {/* Mandatory Disclaimer */}
                  <div className="flex items-start gap-1 mt-3 p-2 bg-muted/50 rounded text-[10px] text-muted-foreground">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Valor estimado. Puede variar según conciliaciones, ajustes contables y validación final.</span>
                  </div>
                </CardContent>
              </Card>

              {/* Retefuente por Pagar */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Retefuente por Pagar
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-accent/10">
                    <Receipt className="h-4 w-4 text-accent" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold text-foreground">
                    {formatCurrency(metrics.retefuentePorPagar)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3 mr-1" />
                    {periodRange.label} (2.5% compras)
                  </div>
                </CardContent>
              </Card>

              {/* Pending Reconciliation */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Pendientes Conciliar
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${metrics.pendingReconcile > 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
                    <AlertCircle className={`h-4 w-4 ${metrics.pendingReconcile > 0 ? 'text-destructive' : 'text-success'}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-xl font-bold ${metrics.pendingReconcile > 0 ? 'text-destructive' : 'text-success'}`}>
                    {metrics.pendingReconcile}
                  </div>
                  <Link to="/transactions" className="text-xs hover:underline mt-1 inline-block text-primary">
                    Ver transacciones →
                  </Link>
                </CardContent>
              </Card>

              {/* 4x1000 (GMF) Accumulated */}
              <GMFAccumulatedCard 
                total={gmfMetrics.total}
                year={gmfMetrics.year}
                transactionCount={gmfMetrics.transactionCount}
              />
            </div>

            {/* RETEICA Metrics */}
            {(reteicaMetrics.monthlyTotal > 0 || reteicaMetrics.yearlyTotal > 0) && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-fade-in">
                <ReteicaMonthlyCard
                  total={reteicaMetrics.monthlyTotal}
                  periodLabel={periodRange.label}
                  transactionCount={reteicaMetrics.monthlyCount}
                />
                <ReteicaYearlyCard
                  total={reteicaMetrics.yearlyTotal}
                  year={periodSelection.year}
                  transactionCount={reteicaMetrics.yearlyCount}
                />
              </div>
            )}

            {/* Charts - Redesigned */}
            <div className="grid gap-6 lg:grid-cols-2 animate-slide-up">
              {/* Income vs Expenses - Stacked Column Chart */}
              <IncomeVsExpenseChart 
                data={incomeVsExpenseData} 
                periodLabel={periodRange.label} 
              />

              {/* Expenses by Category - Vertical Bar Chart */}
              <ExpensesByCategoryChart 
                data={expensesByCategoryData} 
                periodLabel={periodRange.label} 
              />
            </div>

            {/* Pending Transactions Table - Only unreconciled transactions */}
            <PendingTransactionsTable 
              transactions={periodTransactions.map(tx => ({
                id: tx.id,
                date: tx.date,
                description: tx.description,
                amount: tx.amount,
                category_id: tx.category_id,
                category_name: tx.category_name,
                responsible_id: tx.responsible_id,
              }))}
              categories={categories}
              responsibles={responsibles}
              periodLabel={periodRange.label}
              onTransactionUpdated={fetchTransactions}
              onCategoryAdded={fetchCategories}
              onResponsibleAdded={fetchResponsibles}
            />
          </>
        )}
      </div>
    </AppLayout>
  );
}
