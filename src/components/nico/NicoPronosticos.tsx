import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Wallet, Calendar, BarChart3, Zap } from 'lucide-react';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatPct(value: number) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

// Calcula tendencia lineal simple (regresión mínimos cuadrados)
function linearTrend(values: number[]): { slope: number; next: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, next: values[0] || 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  values.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  const next = intercept + slope * n;
  return { slope, next };
}

export default function NicoPronosticos() {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['nico-pronosticos-tx', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('transactions')
        .select('date, amount, type, category_id, categories!transactions_category_id_fkey(name, report_group)')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .gte('date', `${currentYear - 1}-01-01`)
        .order('date', { ascending: true });
      return data || [];
    },
    enabled: !!user?.id,
  });

  const pronosticos = useMemo(() => {
    if (transactions.length === 0) return null;

    // Agrupar por mes: array de 12 posiciones para el año actual + meses previos del año pasado
    const monthlyIngresos: number[] = new Array(12).fill(0);
    const monthlyEgresos: number[] = new Array(12).fill(0);
    const prevYearIngresos: number[] = new Array(12).fill(0);
    const prevYearEgresos: number[] = new Array(12).fill(0);

    transactions.forEach((tx: any) => {
      const date = new Date(tx.date);
      const year = date.getFullYear();
      const month = date.getMonth();
      const amount = Math.abs(tx.amount || 0);
      const isIngreso = (tx.amount || 0) > 0;

      if (year === currentYear) {
        if (isIngreso) monthlyIngresos[month] += amount;
        else monthlyEgresos[month] += amount;
      } else if (year === currentYear - 1) {
        if (isIngreso) prevYearIngresos[month] += amount;
        else prevYearEgresos[month] += amount;
      }
    });

    // Solo meses con datos hasta el mes actual
    const mesesConDatos = currentMonth; // meses anteriores al actual
    const ingresosHistoricos = monthlyIngresos.slice(0, mesesConDatos);
    const egresosHistoricos = monthlyEgresos.slice(0, mesesConDatos);

    // Si hay muy pocos meses, usar también el año anterior
    const ingresosParaTendencia = ingresosHistoricos.length >= 3
      ? ingresosHistoricos
      : [...prevYearIngresos.slice(-3), ...ingresosHistoricos];
    const egresosParaTendencia = egresosHistoricos.length >= 3
      ? egresosHistoricos
      : [...prevYearEgresos.slice(-3), ...egresosHistoricos];

    const trendIngresos = linearTrend(ingresosParaTendencia);
    const trendEgresos = linearTrend(egresosParaTendencia);

    // Pronóstico próximo mes
    const proxMesIngresos = Math.max(0, trendIngresos.next);
    const proxMesEgresos = Math.max(0, trendEgresos.next);
    const proxMesNeto = proxMesIngresos - proxMesEgresos;

    // Promedio actual
    const avgIngresos = ingresosHistoricos.length > 0
      ? ingresosHistoricos.reduce((a, b) => a + b, 0) / ingresosHistoricos.length
      : 0;
    const avgEgresos = egresosHistoricos.length > 0
      ? egresosHistoricos.reduce((a, b) => a + b, 0) / egresosHistoricos.length
      : 0;

    // Variación % vs promedio
    const varIngresos = avgIngresos > 0 ? ((proxMesIngresos - avgIngresos) / avgIngresos) * 100 : 0;
    const varEgresos = avgEgresos > 0 ? ((proxMesEgresos - avgEgresos) / avgEgresos) * 100 : 0;

    // Pronóstico 3 meses (tendencia extendida)
    const trend3Ingresos = ingresosParaTendencia.map((_, i) =>
      Math.max(0, trendIngresos.slope * (ingresosParaTendencia.length + i) + (avgIngresos - trendIngresos.slope * (ingresosParaTendencia.length / 2)))
    ).slice(0, 3);
    const trend3Egresos = egresosParaTendencia.map((_, i) =>
      Math.max(0, trendEgresos.slope * (egresosParaTendencia.length + i) + (avgEgresos - trendEgresos.slope * (egresosParaTendencia.length / 2)))
    ).slice(0, 3);

    const total3MIngresos = [proxMesIngresos, ...trend3Ingresos.slice(0, 2)].reduce((a, b) => a + b, 0);
    const total3MEgresos = [proxMesEgresos, ...trend3Egresos.slice(0, 2)].reduce((a, b) => a + b, 0);
    const neto3M = total3MIngresos - total3MEgresos;

    // Alertas inteligentes
    const alertas: { tipo: 'warning' | 'danger' | 'success'; mensaje: string }[] = [];

    if (proxMesNeto < 0) {
      alertas.push({ tipo: 'danger', mensaje: `La tendencia sugiere resultado neto negativo el próximo mes (${formatCurrency(proxMesNeto)}). Revisá tus gastos.` });
    }
    if (trendEgresos.slope > trendIngresos.slope && trendEgresos.slope > 0) {
      alertas.push({ tipo: 'warning', mensaje: 'Tus egresos crecen más rápido que tus ingresos. Si continúa esta tendencia, el margen se reducirá.' });
    }
    if (varIngresos < -15) {
      alertas.push({ tipo: 'warning', mensaje: `Se proyectan ingresos ${Math.abs(varIngresos).toFixed(0)}% por debajo de tu promedio. ¿Hay estacionalidad o cuentas por cobrar pendientes?` });
    }
    if (proxMesNeto > 0 && varIngresos > 10) {
      alertas.push({ tipo: 'success', mensaje: `Buena tendencia — se proyectan ingresos ${varIngresos.toFixed(0)}% por encima del promedio.` });
    }

    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const proxMesNombre = mesesNombres[(currentMonth) % 12];
    const mes2Nombre = mesesNombres[(currentMonth + 1) % 12];
    const mes3Nombre = mesesNombres[(currentMonth + 2) % 12];

    return {
      proxMes: { ingresos: proxMesIngresos, egresos: proxMesEgresos, neto: proxMesNeto, nombre: proxMesNombre },
      tresMeses: { ingresos: total3MIngresos, egresos: total3MEgresos, neto: neto3M, meses: [proxMesNombre, mes2Nombre, mes3Nombre] },
      variaciones: { ingresos: varIngresos, egresos: varEgresos },
      alertas,
      confianza: Math.min(ingresosHistoricos.filter(v => v > 0).length * 15, 90),
    };
  }, [transactions, currentMonth, currentYear]);

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Analizando tendencias...</div>;
  }

  if (!pronosticos) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Necesito al menos 2 meses de datos para generar pronósticos.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Confianza */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Zap className="h-3.5 w-3.5 text-accent" />
        <span>Pronóstico basado en regresión de tendencia · Confianza: <strong>{pronosticos.confianza}%</strong></span>
      </div>

      {/* Alertas */}
      {pronosticos.alertas.length > 0 && (
        <div className="space-y-2">
          {pronosticos.alertas.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
              a.tipo === 'danger' ? 'bg-destructive/10 text-destructive' :
              a.tipo === 'warning' ? 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-400' :
              'bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-400'
            }`}>
              {a.tipo === 'danger' ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> :
               a.tipo === 'warning' ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> :
               <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <span>{a.mensaje}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pronóstico próximo mes */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-accent" />
          Próximo mes — {pronosticos.proxMes.nombre}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <TrendingUp className="h-3 w-3 text-green-500" />
                Ingresos est.
              </div>
              <p className="text-lg font-bold text-green-600">{formatCurrency(pronosticos.proxMes.ingresos)}</p>
              <p className={`text-xs mt-1 ${pronosticos.variaciones.ingresos >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {formatPct(pronosticos.variaciones.ingresos)} vs promedio
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <TrendingDown className="h-3 w-3 text-red-500" />
                Egresos est.
              </div>
              <p className="text-lg font-bold text-red-500">{formatCurrency(pronosticos.proxMes.egresos)}</p>
              <p className={`text-xs mt-1 ${pronosticos.variaciones.egresos <= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {formatPct(pronosticos.variaciones.egresos)} vs promedio
              </p>
            </CardContent>
          </Card>
          <Card className={`border-0 shadow-sm ${pronosticos.proxMes.neto >= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Wallet className="h-3 w-3" />
                Resultado neto
              </div>
              <p className={`text-lg font-bold ${pronosticos.proxMes.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(pronosticos.proxMes.neto)}
              </p>
              <p className="text-xs mt-1 text-muted-foreground">proyectado</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pronóstico 3 meses */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          Acumulado 3 meses — {pronosticos['tresMeses'].meses.join(', ')}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Ingresos acum.</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(pronosticos['tresMeses'].ingresos)}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Egresos acum.</p>
              <p className="text-lg font-bold text-red-500">{formatCurrency(pronosticos['tresMeses'].egresos)}</p>
            </CardContent>
          </Card>
          <Card className={`border-0 shadow-sm ${pronosticos['tresMeses'].neto >= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Neto acum.</p>
              <p className={`text-lg font-bold ${pronosticos['tresMeses'].neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(pronosticos['tresMeses'].neto)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground italic">
        * Pronósticos basados en regresión lineal de datos históricos. No garantizan resultados futuros. Consultá con tu contador para decisiones financieras importantes.
      </p>
    </div>
  );
}
