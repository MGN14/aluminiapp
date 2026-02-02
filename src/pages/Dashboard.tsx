import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Wallet, Flame, Receipt, Loader2, ArrowUpRight, ArrowDownRight, AlertCircle, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getCuatrimestreForPeriod, getMonthPeriod, isDIANPayment, MONTH_NAMES } from '@/types/transaction';
import { PeriodSelector } from '@/components/dashboard/PeriodSelector';
import { MonthlySummaryTable } from '@/components/dashboard/MonthlySummaryTable';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
interface TransactionData {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  balance: number | null;
  category: string | null;
  responsible_id: string | null;
  has_iva: boolean;
  has_retefuente: boolean;
  iva_amount: number;
  retefuente_amount: number;
}
interface Metrics {
  saldoActual: number;
  totalIngresos: number;
  totalEgresos: number;
  burnRate: number;
  ivaPorPagar: number;
  retefuentePorPagar: number;
  pendingReconcile: number;
  transactionCount: number;
  cuatrimestreLabel: string;
  monthLabel: string;
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
  const [loading, setLoading] = useState(true);

  // Period selection state - default to current month/year, will be updated from data
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [periodInitialized, setPeriodInitialized] = useState(false);
  useEffect(() => {
    fetchTransactions();
    initializePeriodFromData();
  }, []);
  const initializePeriodFromData = async () => {
    try {
      // First try to get period from most recent statement
      const {
        data: statement
      } = await supabase.from('bank_statements').select('statement_month, statement_year').order('uploaded_at', {
        ascending: false
      }).limit(1).single();
      if (statement?.statement_month && statement?.statement_year) {
        setSelectedMonth(statement.statement_month);
        setSelectedYear(statement.statement_year);
        setPeriodInitialized(true);
        return;
      }

      // Fallback to most recent transaction date
      const {
        data: transaction
      } = await supabase.from('transactions').select('date').order('date', {
        ascending: false
      }).limit(1).single();
      if (transaction?.date) {
        const date = new Date(transaction.date);
        setSelectedMonth(date.getMonth() + 1);
        setSelectedYear(date.getFullYear());
      }
      setPeriodInitialized(true);
    } catch (error) {
      console.error('Error initializing period:', error);
      setPeriodInitialized(true);
    }
  };
  const fetchTransactions = async () => {
    try {
      const {
        data,
        error
      } = await supabase.from('transactions').select('id, date, description, amount, balance, category, responsible_id, has_iva, has_retefuente, iva_amount, retefuente_amount').order('date', {
        ascending: true
      });
      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };
  const handlePeriodChange = (month: number, year: number) => {
    setSelectedMonth(month);
    setSelectedYear(year);
  };

  // Calculate periods based on selection
  const cuatrimestre = useMemo(() => getCuatrimestreForPeriod(selectedMonth, selectedYear), [selectedMonth, selectedYear]);
  const monthPeriod = useMemo(() => getMonthPeriod(selectedMonth, selectedYear), [selectedMonth, selectedYear]);
  const metrics = useMemo((): Metrics => {
    if (transactions.length === 0) {
      return {
        saldoActual: 0,
        totalIngresos: 0,
        totalEgresos: 0,
        burnRate: 0,
        ivaPorPagar: 0,
        retefuentePorPagar: 0,
        pendingReconcile: 0,
        transactionCount: 0,
        cuatrimestreLabel: cuatrimestre.label,
        monthLabel: monthPeriod.label
      };
    }

    // Filter transactions for the selected month
    const monthTransactions = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= monthPeriod.start && txDate <= monthPeriod.end;
    });

    // Filter transactions for the cuatrimestre (for IVA)
    const cuatrimestreTransactions = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
    });

    // Get the last balance from the most recent transaction in the selected month
    const sortedByDate = [...monthTransactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const saldoActual = sortedByDate[0]?.balance ?? 0;

    // Total income and expenses for selected month
    const totalIngresos = monthTransactions.filter(tx => (tx.amount ?? 0) > 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
    const totalEgresos = Math.abs(monthTransactions.filter(tx => (tx.amount ?? 0) < 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0));

    // Burn rate (average monthly expenses based on available data in cuatrimestre)
    const cuatrimestreExpenses = cuatrimestreTransactions.filter(tx => (tx.amount ?? 0) < 0);
    const monthsWithData = new Set(cuatrimestreExpenses.map(tx => {
      const d = new Date(tx.date);
      return `${d.getFullYear()}-${d.getMonth()}`;
    })).size || 1;
    const burnRate = Math.abs(cuatrimestreExpenses.reduce((sum, tx) => sum + (tx.amount ?? 0), 0)) / monthsWithData;

    // IVA por pagar (cuatrimestral) - using server-calculated iva_amount
    const ivaPorPagar = cuatrimestreTransactions.reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);

    // Detect DIAN payments and subtract from IVA
    const dianPayments = cuatrimestreTransactions.filter(tx => isDIANPayment(tx.description));
    const totalDianPayments = Math.abs(dianPayments.reduce((sum, tx) => sum + (tx.amount ?? 0), 0));

    // Retefuente por pagar (mensual) - using server-calculated retefuente_amount
    const retefuentePorPagar = monthTransactions.reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);

    // Pending reconciliation = transactions without responsible (for selected month)
    const pendingReconcile = monthTransactions.filter(tx => !tx.responsible_id).length;
    return {
      saldoActual,
      totalIngresos,
      totalEgresos,
      burnRate,
      ivaPorPagar: Math.max(0, ivaPorPagar - totalDianPayments),
      retefuentePorPagar,
      pendingReconcile,
      transactionCount: monthTransactions.length,
      cuatrimestreLabel: cuatrimestre.label,
      monthLabel: monthPeriod.label
    };
  }, [transactions, cuatrimestre, monthPeriod]);

  // Chart data: Income vs Expenses by month (all data)
  const incomeVsExpenseData = useMemo(() => {
    const monthlyData: Record<string, {
      month: string;
      ingresos: number;
      egresos: number;
    }> = {};
    transactions.forEach(tx => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('es-CO', {
        month: 'short',
        year: '2-digit'
      });
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthLabel,
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
    return Object.entries(monthlyData).sort(([a], [b]) => a.localeCompare(b)).map(([, data]) => data);
  }, [transactions]);

  // Chart data: Expenses by category (selected month)
  const expensesByCategoryData = useMemo(() => {
    const categoryData: Record<string, number> = {};
    const monthTransactions = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= monthPeriod.start && txDate <= monthPeriod.end;
    });
    monthTransactions.forEach(tx => {
      if ((tx.amount ?? 0) < 0 && tx.category) {
        const cat = tx.category;
        categoryData[cat] = (categoryData[cat] || 0) + Math.abs(tx.amount ?? 0);
      }
    });
    const categoryLabels: Record<string, string> = {
      ventas: 'Ventas',
      nomina: 'Nómina',
      proveedores: 'Proveedores',
      servicios: 'Servicios',
      impuestos: 'Impuestos',
      transferencias: 'Transferencias',
      gastos_operativos: 'Gastos Op.',
      otros: 'Otros'
    };
    return Object.entries(categoryData).map(([category, value]) => ({
      category: categoryLabels[category] || category,
      value
    })).sort((a, b) => b.value - a.value);
  }, [transactions, monthPeriod]);

  // Chart data: IVA accumulation over time (cuatrimestre)
  const ivaAccumulationData = useMemo(() => {
    let accumulated = 0;
    const data: {
      date: string;
      iva: number;
    }[] = [];
    transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(tx => {
      accumulated += tx.iva_amount ?? 0;
      if (isDIANPayment(tx.description)) {
        accumulated -= Math.abs(tx.amount ?? 0);
      }
      const dateLabel = new Date(tx.date).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short'
      });
      data.push({
        date: dateLabel,
        iva: Math.max(0, accumulated)
      });
    });
    return data;
  }, [transactions, cuatrimestre]);
  if (loading || !periodInitialized) {
    return <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>;
  }
  return <AppLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header with Period Selector */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">
              Resumen financiero para {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <PeriodSelector selectedMonth={selectedMonth} selectedYear={selectedYear} onPeriodChange={handlePeriodChange} />
            <Link to="/statement-upload">
              <Button>Subir Extracto</Button>
            </Link>
          </div>
        </div>

        {metrics.transactionCount === 0 && transactions.length === 0 ? <Card className="animate-fade-in">
            <CardContent className="py-12 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No hay datos aún
              </h3>
              <p className="text-muted-foreground mb-6">
                Sube tu primer extracto bancario para ver tus métricas financieras.
              </p>
              <Link to="/statement-upload">
                <Button>Subir Extracto</Button>
              </Link>
            </CardContent>
          </Card> : metrics.transactionCount === 0 ? <Card className="animate-fade-in">
            <CardContent className="py-12 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Sin transacciones en este periodo
              </h3>
              <p className="text-muted-foreground mb-6">
                No hay transacciones para {MONTH_NAMES[selectedMonth - 1]} {selectedYear}. 
                Selecciona otro periodo o sube un extracto.
              </p>
            </CardContent>
          </Card> : <>
            {/* Main Metrics Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-fade-in">
              {/* Saldo Actual */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Saldo Final del Mes
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
                    {metrics.monthLabel}
                  </div>
                </CardContent>
              </Card>

              {/* Total Ingresos */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Ingresos del Mes
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
                    {metrics.monthLabel}
                  </div>
                </CardContent>
              </Card>

              {/* Total Egresos */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Egresos del Mes
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-500">
                    {formatCurrency(metrics.totalEgresos)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <ArrowDownRight className="h-3 w-3 mr-1 text-destructive" />
                    {metrics.monthLabel}
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
            <div className="grid gap-4 md:grid-cols-3 animate-fade-in">
              {/* IVA por Pagar */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    IVA por Pagar (Cuatrimestre)
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-accent/10">
                    <Receipt className="h-4 w-4 text-accent" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">
                    {formatCurrency(metrics.ivaPorPagar)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3 mr-1" />
                    {metrics.cuatrimestreLabel}
                  </div>
                </CardContent>
              </Card>

              {/* Retefuente por Pagar */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Retefuente por Pagar (Mes)
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-accent/10">
                    <Receipt className="h-4 w-4 text-accent" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">
                    {formatCurrency(metrics.retefuentePorPagar)}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3 mr-1" />
                    {metrics.monthLabel} (2.5%)
                  </div>
                </CardContent>
              </Card>

              {/* Pending Reconciliation */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Pendientes por Conciliar
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${metrics.pendingReconcile > 0 ? 'bg-destructive/10' : 'bg-success/10'}`}>
                    <AlertCircle className={`h-4 w-4 ${metrics.pendingReconcile > 0 ? 'text-destructive' : 'text-success'}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="">
                    {metrics.pendingReconcile}
                  </div>
                  <Link to="/transactions" className="text-xs text-accent hover:underline mt-1 inline-block">
                    Ver transacciones →
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-2 animate-slide-up">
              {/* Income vs Expenses */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Ingresos vs Egresos</CardTitle>
                </CardHeader>
                <CardContent>
                  {incomeVsExpenseData.length > 0 ? <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={incomeVsExpenseData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{
                    fontSize: 12
                  }} className="text-muted-foreground" />
                        <YAxis tickFormatter={formatCurrencyShort} tick={{
                    fontSize: 12
                  }} className="text-muted-foreground" />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} labelFormatter={label => `Periodo: ${label}`} contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }} />
                        <Legend />
                        <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="hsl(var(--success))" strokeWidth={2} dot={{
                    fill: 'hsl(var(--success))'
                  }} />
                        <Line type="monotone" dataKey="egresos" name="Egresos" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{
                    fill: 'hsl(var(--destructive))'
                  }} />
                      </LineChart>
                    </ResponsiveContainer> : <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                      Sin datos para graficar
                    </div>}
                </CardContent>
              </Card>

              {/* Expenses by Category */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Egresos por Categoría ({metrics.monthLabel})</CardTitle>
                </CardHeader>
                <CardContent>
                  {expensesByCategoryData.length > 0 ? <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={expensesByCategoryData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" tickFormatter={formatCurrencyShort} tick={{
                    fontSize: 12
                  }} />
                        <YAxis type="category" dataKey="category" tick={{
                    fontSize: 12
                  }} width={80} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }} />
                        <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} name="Monto" />
                      </BarChart>
                    </ResponsiveContainer> : <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                      Sin egresos categorizados
                    </div>}
                </CardContent>
              </Card>
            </div>

            {/* IVA Accumulation Chart */}
            <Card className="animate-slide-up">
              <CardHeader>
                <CardTitle className="text-lg">Acumulación de IVA ({metrics.cuatrimestreLabel})</CardTitle>
              </CardHeader>
              <CardContent>
                {ivaAccumulationData.length > 0 ? <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={ivaAccumulationData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{
                  fontSize: 10
                }} interval="preserveStartEnd" />
                      <YAxis tickFormatter={formatCurrencyShort} tick={{
                  fontSize: 12
                }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} labelFormatter={label => `Fecha: ${label}`} contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }} />
                      <Line type="monotone" dataKey="iva" name="IVA Acumulado" stroke="hsl(var(--accent))" strokeWidth={2} fill="hsl(var(--accent))" fillOpacity={0.1} />
                    </LineChart>
                  </ResponsiveContainer> : <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    Sin datos de IVA en el cuatrimestre
                  </div>}
              </CardContent>
            </Card>

            {/* Monthly Summary Table */}
            <MonthlySummaryTable transactions={transactions} selectedMonth={selectedMonth} selectedYear={selectedYear} />
          </>}
      </div>
    </AppLayout>;
}