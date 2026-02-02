import { useState, useEffect } from 'react';
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
  ArrowDownRight
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface Metrics {
  totalIngresos: number;
  totalEgresos: number;
  saldo: number;
  burnRate: number;
  ivaEstimado: number;
  transactionCount: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>({
    totalIngresos: 0,
    totalEgresos: 0,
    saldo: 0,
    burnRate: 0,
    ivaEstimado: 0,
    transactionCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('amount, vat_amount, affects_dian, date');

      if (error) throw error;

      if (!data || data.length === 0) {
        setLoading(false);
        return;
      }

      // Calculate metrics
      const totalIngresos = data
        .filter(tx => (tx.amount ?? 0) > 0)
        .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);

      const totalEgresos = Math.abs(
        data
          .filter(tx => (tx.amount ?? 0) < 0)
          .reduce((sum, tx) => sum + (tx.amount ?? 0), 0)
      );

      const saldo = totalIngresos - totalEgresos;

      // Calculate burn rate (average monthly expenses)
      // Group expenses by month and average
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const recentExpenses = data.filter(tx => {
        const txDate = new Date(tx.date);
        return (tx.amount ?? 0) < 0 && txDate >= threeMonthsAgo;
      });
      
      const burnRate = recentExpenses.length > 0 
        ? Math.abs(recentExpenses.reduce((sum, tx) => sum + (tx.amount ?? 0), 0)) / 3
        : totalEgresos;

      // IVA estimado (suma de vat_amount donde affects_dian = true)
      const ivaEstimado = data
        .filter(tx => tx.affects_dian)
        .reduce((sum, tx) => sum + (tx.vat_amount ?? 0), 0);

      setMetrics({
        totalIngresos,
        totalEgresos,
        saldo,
        burnRate,
        ivaEstimado,
        transactionCount: data.length,
      });
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

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
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">
              Resumen financiero de tus movimientos
            </p>
          </div>
          <Link to="/statement-upload">
            <Button>
              Subir Extracto
            </Button>
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-fade-in">
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

              {/* Saldo */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Saldo Neto
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-accent/10">
                    <Wallet className="h-4 w-4 text-accent" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${metrics.saldo >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(metrics.saldo)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Ingresos - Egresos
                  </div>
                </CardContent>
              </Card>

              {/* Burn Rate */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Burn Rate Mensual
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
                    Promedio de gastos mensuales
                  </div>
                </CardContent>
              </Card>

              {/* IVA Estimado */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    IVA Estimado por Pagar
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-accent/10">
                    <Receipt className="h-4 w-4 text-accent" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    {formatCurrency(metrics.ivaEstimado)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Suma IVA donde afecta DIAN
                  </div>
                </CardContent>
              </Card>

              {/* Transaction Count */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Transacciones
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-muted">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    {metrics.transactionCount}
                  </div>
                  <Link to="/transactions" className="text-xs text-accent hover:underline mt-1 inline-block">
                    Ver todas →
                  </Link>
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
