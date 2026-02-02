import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Flame, 
  Receipt,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  Calendar
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  getCurrentCuatrimestre,
  getCurrentMonth,
  isDIANPayment
} from '@/types/transaction';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

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
    maximumFractionDigits: 0,
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

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, date, description, amount, balance, category, responsible_id, has_iva, has_retefuente, iva_amount, retefuente_amount')
        .order('date', { ascending: true });

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

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
        cuatrimestreLabel: '',
        monthLabel: '',
      };
    }

    const cuatrimestre = getCurrentCuatrimestre();
    const currentMonth = getCurrentMonth();

    // Get the last balance from the most recent transaction
    const sortedByDate = [...transactions].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const saldoActual = sortedByDate[0]?.balance ?? 0;

    // Total income and expenses
    const totalIngresos = transactions
      .filter(tx => (tx.amount ?? 0) > 0)
      .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);

    const totalEgresos = Math.abs(
      transactions
        .filter(tx => (tx.amount ?? 0) < 0)
        .reduce((sum, tx) => sum + (tx.amount ?? 0), 0)
    );

    // Burn rate (average monthly expenses over last 3 months)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const recentExpenses = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return (tx.amount ?? 0) < 0 && txDate >= threeMonthsAgo;
    });
    
    const burnRate = recentExpenses.length > 0 
      ? Math.abs(recentExpenses.reduce((sum, tx) => sum + (tx.amount ?? 0), 0)) / 3
      : totalEgresos;

    // IVA por pagar (cuatrimestral) - using server-calculated iva_amount
    const ivaPorPagar = transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
      })
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);

    // Detect DIAN payments and subtract from IVA
    const dianPayments = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return isDIANPayment(tx.description) && 
             txDate >= cuatrimestre.start && 
             txDate <= cuatrimestre.end;
    });
    
    const totalDianPayments = Math.abs(
      dianPayments.reduce((sum, tx) => sum + (tx.amount ?? 0), 0)
    );

    // Retefuente por pagar (mensual) - using server-calculated retefuente_amount
    const retefuentePorPagar = transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= currentMonth.start && txDate <= currentMonth.end;
      })
      .reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);

    // Pending reconciliation = transactions without responsible
    const pendingReconcile = transactions.filter(tx => !tx.responsible_id).length;

    return {
      saldoActual,
      totalIngresos,
      totalEgresos,
      burnRate,
      ivaPorPagar: Math.max(0, ivaPorPagar - totalDianPayments),
      retefuentePorPagar,
      pendingReconcile,
      transactionCount: transactions.length,
      cuatrimestreLabel: cuatrimestre.label,
      monthLabel: currentMonth.label,
    };
  }, [transactions]);

  // Chart data: Income vs Expenses by month
  const incomeVsExpenseData = useMemo(() => {
    const monthlyData: Record<string, { month: string; ingresos: number; egresos: number }> = {};
    
    transactions.forEach(tx => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { month: monthLabel, ingresos: 0, egresos: 0 };
      }
      
      const amount = tx.amount ?? 0;
      if (amount > 0) {
        monthlyData[monthKey].ingresos += amount;
      } else {
        monthlyData[monthKey].egresos += Math.abs(amount);
      }
    });
    
    return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions]);

  // Chart data: Expenses by category
  const expensesByCategoryData = useMemo(() => {
    const categoryData: Record<string, number> = {};
    
    transactions.forEach(tx => {
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
      otros: 'Otros',
    };
    
    return Object.entries(categoryData)
      .map(([category, value]) => ({
        category: categoryLabels[category] || category,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  // Chart data: IVA accumulation over time
  const ivaAccumulationData = useMemo(() => {
    const cuatrimestre = getCurrentCuatrimestre();
    let accumulated = 0;
    const data: { date: string; iva: number }[] = [];
    
    transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach(tx => {
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
          iva: Math.max(0, accumulated),
        });
      });
    
    return data;
  }, [transactions]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">
              Resumen financiero calculado desde tus transacciones
            </p>
          </div>
          <Link to="/statement-upload">
            <Button>Subir Extracto</Button>
          </Link>
        </div>

        {metrics.transactionCount === 0 ? (
          <Card className="animate-fade-in">
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
          </Card>
        ) : (
          <>
            {/* Main Metrics Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-fade-in">
              {/* Saldo Actual */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Saldo Actual
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
                    Último saldo registrado
                  </div>
                </CardContent>
              </Card>

              {/* Total Ingresos */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Ingresos
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
                    Entradas de dinero
                  </div>
                </CardContent>
              </Card>

              {/* Total Egresos */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Egresos
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
                    Salidas de dinero
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
                    Promedio mensual (3 meses)
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
                  <div className="text-2xl font-bold text-accent">
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
                  <div className="text-2xl font-bold text-accent">
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
                  <div className={`text-2xl font-bold ${metrics.pendingReconcile > 0 ? 'text-destructive' : 'text-success'}`}>
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
                  {incomeVsExpenseData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={incomeVsExpenseData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend />
                        <Line 
                          type="monotone" 
                          dataKey="ingresos" 
                          stroke="hsl(var(--success))" 
                          strokeWidth={2}
                          name="Ingresos"
                        />
                        <Line 
                          type="monotone" 
                          dataKey="egresos" 
                          stroke="hsl(var(--destructive))" 
                          strokeWidth={2}
                          name="Egresos"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                      No hay datos suficientes
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Expenses by Category */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Gastos por Categoría</CardTitle>
                </CardHeader>
                <CardContent>
                  {expensesByCategoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={expensesByCategoryData} layout="horizontal">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                        <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Bar dataKey="value" fill="hsl(var(--accent))" name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                      No hay gastos categorizados
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* IVA Accumulation */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Acumulación de IVA - {metrics.cuatrimestreLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  {ivaAccumulationData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={ivaAccumulationData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Line 
                          type="stepAfter" 
                          dataKey="iva" 
                          stroke="hsl(var(--accent))" 
                          strokeWidth={2}
                          name="IVA Acumulado"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      No hay transacciones con IVA en este cuatrimestre
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card className="animate-slide-up">
              <CardHeader>
                <CardTitle className="text-lg">Acciones Rápidas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  <Link to="/statement-upload">
                    <Button variant="outline">Subir Extracto</Button>
                  </Link>
                  <Link to="/transactions">
                    <Button variant="outline">Ver Transacciones</Button>
                  </Link>
                  <Link to="/export">
                    <Button variant="outline">Exportar Excel</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
