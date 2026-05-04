import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Wallet, Calendar, BarChart3, Zap, Flag } from 'lucide-react';
import { MONTH_LABELS_SHORT } from '@/lib/constants';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatPct(value: number) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

// Tendencia lineal (mínimos cuadrados)
function linearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const slope = den !== 0 ? num / den : 0;
  return { slope, intercept: yMean - slope * xMean };
}

// Proyección robusta: pondera promedio histórico (70%) + tendencia (30%)
// Nunca baja de 40% del promedio histórico para evitar proyecciones irreales
function projectMonth(values: number[], offset: number): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const { slope, intercept } = linearTrend(values);
  const trendVal = intercept + slope * (values.length + offset);
  const projected = avg * 0.7 + trendVal * 0.3;
  return Math.max(avg * 0.4, projected);
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
        .select('date, amount, type, description, has_retefuente, retefuente_amount, has_reteica, reteica_amount')
        .is('deleted_at', null)
        .gte('date', `${currentYear - 1}-01-01`)
        .order('date', { ascending: true });
      return data || [];
    },
    enabled: !!user?.id,
  });

  const pronosticos = useMemo(() => {
    if (transactions.length === 0) return null;

    const monthlyIngresos = new Array(12).fill(0);
    const monthlyEgresos = new Array(12).fill(0);
    const prevYearIngresos = new Array(12).fill(0);
    const prevYearEgresos = new Array(12).fill(0);

    // Impuestos acumulados año actual
    let retefuenteAcum = 0;
    let reteicaAcum = 0;
    let gmf4x1000Acum = 0;

    transactions.forEach((tx: any) => {
      const date = new Date(tx.date);
      const year = date.getFullYear();
      const month = date.getMonth();
      const amount = Math.abs(tx.amount || 0);
      const isIngreso = (tx.amount || 0) > 0;

      if (year === currentYear) {
        if (isIngreso) monthlyIngresos[month] += amount;
        else monthlyEgresos[month] += amount;
        if (tx.has_retefuente && tx.retefuente_amount > 0) retefuenteAcum += tx.retefuente_amount;
        if (tx.has_reteica && tx.reteica_amount > 0) reteicaAcum += tx.reteica_amount;
        const desc = (tx.description || '').toUpperCase();
        if (desc.includes('4X1000') || desc.includes('GMF') || desc.includes('IMPTO GOBIERNO') || desc.includes('GRAVAMEN')) {
          gmf4x1000Acum += amount;
        }
      } else if (year === currentYear - 1) {
        if (isIngreso) prevYearIngresos[month] += amount;
        else prevYearEgresos[month] += amount;
      }
    });

    // Histórico: incluir mes actual parcial si tiene datos
    const mesesHistorico = currentMonth + (monthlyIngresos[currentMonth] > 0 ? 1 : 0);
    const ingresosHistoricos = monthlyIngresos.slice(0, mesesHistorico);
    const egresosHistoricos = monthlyEgresos.slice(0, mesesHistorico);

    // Completar con año anterior si hay pocos meses
    const ingresosBase = ingresosHistoricos.length >= 3
      ? ingresosHistoricos
      : [...prevYearIngresos.slice(-(3 - ingresosHistoricos.length)), ...ingresosHistoricos];
    const egresosBase = egresosHistoricos.length >= 3
      ? egresosHistoricos
      : [...prevYearEgresos.slice(-(3 - egresosHistoricos.length)), ...egresosHistoricos];

    const avgIngresos = ingresosBase.length > 0 ? ingresosBase.reduce((a, b) => a + b, 0) / ingresosBase.length : 0;
    const avgEgresos = egresosBase.length > 0 ? egresosBase.reduce((a, b) => a + b, 0) / egresosBase.length : 0;

    // Próximo mes
    const proxMesIngresos = projectMonth(ingresosBase, 0);
    const proxMesEgresos = projectMonth(egresosBase, 0);
    const proxMesNeto = proxMesIngresos - proxMesEgresos;

    const varIngresos = avgIngresos > 0 ? ((proxMesIngresos - avgIngresos) / avgIngresos) * 100 : 0;
    const varEgresos = avgEgresos > 0 ? ((proxMesEgresos - avgEgresos) / avgEgresos) * 100 : 0;

    // 3 meses
    const ing3 = [0, 1, 2].map(i => projectMonth(ingresosBase, i));
    const egr3 = [0, 1, 2].map(i => projectMonth(egresosBase, i));
    const total3MIngresos = ing3.reduce((a, b) => a + b, 0);
    const total3MEgresos = egr3.reduce((a, b) => a + b, 0);

    const mesesNombres = MONTH_LABELS_SHORT;

    // Cierre del año: real para meses pasados, proyectado para futuros
    const mesAMes = Array.from({ length: 12 }, (_, m) => {
      const esReal = m < currentMonth;
      let ingProy = monthlyIngresos[m];
      let egrProy = monthlyEgresos[m];
      if (!esReal) {
        const offset = m - currentMonth;
        ingProy = projectMonth(ingresosBase, offset);
        egrProy = projectMonth(egresosBase, offset);
      }
      return { mes: mesesNombres[m], ingresos: ingProy, egresos: egrProy, neto: ingProy - egrProy, esReal };
    });

    const cierreIngresos = mesAMes.reduce((s, m) => s + m.ingresos, 0);
    const cierreEgresos = mesAMes.reduce((s, m) => s + m.egresos, 0);
    const cierreNeto = cierreIngresos - cierreEgresos;
    const cierreRenta = cierreNeto > 0 ? cierreNeto * 0.35 : 0;

    // Proyección impuestos al cierre (proporción sobre meses restantes)
    const mesesRestantes = 12 - currentMonth;
    const mesesTranscurridos = Math.max(currentMonth, 1);
    const retefuenteProyAnio = retefuenteAcum + (retefuenteAcum / mesesTranscurridos) * mesesRestantes;
    const reteicaProyAnio = reteicaAcum + (reteicaAcum / mesesTranscurridos) * mesesRestantes;
    const gmfProyAnio = gmf4x1000Acum + (gmf4x1000Acum / mesesTranscurridos) * mesesRestantes;

    // Comparación vs año anterior
    const prevAnioIngresos = prevYearIngresos.reduce((a, b) => a + b, 0);
    const prevAnioNeto = prevAnioIngresos - prevYearEgresos.reduce((a, b) => a + b, 0);
    const varAnioIngresos = prevAnioIngresos > 0 ? ((cierreIngresos - prevAnioIngresos) / prevAnioIngresos) * 100 : 0;
    const varAnioNeto = prevAnioNeto !== 0 ? ((cierreNeto - prevAnioNeto) / Math.abs(prevAnioNeto)) * 100 : 0;
    const faltaParaSuperarAnio = Math.max(0, prevAnioIngresos - monthlyIngresos.reduce((a, b) => a + b, 0));

    // Alertas
    const alertas: { tipo: 'warning' | 'danger' | 'success'; mensaje: string }[] = [];
    if (proxMesNeto < 0) alertas.push({ tipo: 'danger', mensaje: `Tendencia sugiere resultado neto negativo el próximo mes (${formatCurrency(proxMesNeto)}). Revisá tus gastos.` });
    if (varEgresos > 15) alertas.push({ tipo: 'warning', mensaje: `Egresos proyectados ${varEgresos.toFixed(0)}% por encima del promedio. Revisá si hay gastos extraordinarios.` });
    if (varIngresos < -15) alertas.push({ tipo: 'warning', mensaje: `Ingresos proyectados ${Math.abs(varIngresos).toFixed(0)}% por debajo del promedio. ¿Hay CxC pendientes?` });
    if (proxMesNeto > 0 && varIngresos > 10) alertas.push({ tipo: 'success', mensaje: `Buena tendencia — ingresos proyectados ${varIngresos.toFixed(0)}% por encima del promedio.` });
    if (cierreNeto < 0) alertas.push({ tipo: 'danger', mensaje: `Proyección indica cierre del año con pérdida neta de ${formatCurrency(Math.abs(cierreNeto))}. Se requiere acción urgente.` });
    if (faltaParaSuperarAnio > 0) alertas.push({ tipo: 'warning', mensaje: `Para superar las ventas del ${currentYear - 1} te faltan ${formatCurrency(faltaParaSuperarAnio)} en ingresos.` });

    return {
      proxMes: { ingresos: proxMesIngresos, egresos: proxMesEgresos, neto: proxMesNeto, nombre: mesesNombres[currentMonth % 12] },
      tresMeses: { ingresos: total3MIngresos, egresos: total3MEgresos, neto: total3MIngresos - total3MEgresos, meses: [0, 1, 2].map(i => mesesNombres[(currentMonth + i) % 12]) },
      variaciones: { ingresos: varIngresos, egresos: varEgresos },
      alertas,
      confianza: Math.min(ingresosHistoricos.filter(v => v > 0).length * 15, 90),
      cierreAnio: { ingresos: cierreIngresos, egresos: cierreEgresos, neto: cierreNeto, renta: cierreRenta, varIngresos: varAnioIngresos, varNeto: varAnioNeto },
      impuestosCierre: { retefuente: retefuenteProyAnio, reteica: reteicaProyAnio, gmf: gmfProyAnio },
      mesAMes,
    };
  }, [transactions, currentMonth, currentYear]);

  if (isLoading) return <div className="text-center py-12 text-muted-foreground text-sm">Analizando tendencias...</div>;
  if (!pronosticos) return <div className="text-center py-12 text-muted-foreground text-sm">Necesito al menos 2 meses de datos para generar pronósticos.</div>;

  return (
    <div className="space-y-5">
      {/* Confianza */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Zap className="h-3.5 w-3.5 text-accent" />
        <span>Pronóstico basado en promedio ponderado + tendencia · Confianza: <strong>{pronosticos.confianza}%</strong></span>
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
              {a.tipo === 'success' ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
              <span>{a.mensaje}</span>
            </div>
          ))}
        </div>
      )}

      {/* Próximo mes */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-accent" />
          Próximo mes — {pronosticos.proxMes.nombre}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm"><CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1"><TrendingUp className="h-3 w-3 text-green-500" />Ingresos est.</div>
            <p className="text-lg font-bold text-green-600">{formatCurrency(pronosticos.proxMes.ingresos)}</p>
            <p className={`text-xs mt-1 ${pronosticos.variaciones.ingresos >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatPct(pronosticos.variaciones.ingresos)} vs promedio</p>
          </CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1"><TrendingDown className="h-3 w-3 text-red-500" />Egresos est.</div>
            <p className="text-lg font-bold text-red-500">{formatCurrency(pronosticos.proxMes.egresos)}</p>
            <p className={`text-xs mt-1 ${pronosticos.variaciones.egresos <= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatPct(pronosticos.variaciones.egresos)} vs promedio</p>
          </CardContent></Card>
          <Card className={`border-0 shadow-sm ${pronosticos.proxMes.neto >= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}><CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1"><Wallet className="h-3 w-3" />Resultado neto</div>
            <p className={`text-lg font-bold ${pronosticos.proxMes.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(pronosticos.proxMes.neto)}</p>
            <p className="text-xs mt-1 text-muted-foreground">proyectado</p>
          </CardContent></Card>
        </div>
      </div>

      {/* 3 meses */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          Acumulado 3 meses — {pronosticos.tresMeses.meses.join(', ')}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm"><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Ingresos acum.</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(pronosticos.tresMeses.ingresos)}</p>
          </CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Egresos acum.</p>
            <p className="text-lg font-bold text-red-500">{formatCurrency(pronosticos.tresMeses.egresos)}</p>
          </CardContent></Card>
          <Card className={`border-0 shadow-sm ${pronosticos.tresMeses.neto >= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Neto acum.</p>
            <p className={`text-lg font-bold ${pronosticos.tresMeses.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(pronosticos.tresMeses.neto)}</p>
          </CardContent></Card>
        </div>
      </div>

      {/* Cierre del año */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Flag className="h-4 w-4 text-accent" />
          Cierre del año {currentYear} — Proyección al 31 de diciembre
        </h3>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card className="border-0 shadow-sm"><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Ingresos proyectados totales</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(pronosticos.cierreAnio.ingresos)}</p>
            <p className={`text-xs mt-1 ${pronosticos.cierreAnio.varIngresos >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {formatPct(pronosticos.cierreAnio.varIngresos)} vs {currentYear - 1}
            </p>
          </CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground mb-1">Egresos proyectados totales</p>
            <p className="text-xl font-bold text-red-500">{formatCurrency(pronosticos.cierreAnio.egresos)}</p>
          </CardContent></Card>
          <Card className={`border-0 shadow-sm col-span-2 ${pronosticos.cierreAnio.neto >= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Resultado neto proyectado al cierre</p>
                  <p className={`text-2xl font-bold ${pronosticos.cierreAnio.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(pronosticos.cierreAnio.neto)}</p>
                  <p className={`text-xs mt-1 ${pronosticos.cierreAnio.varNeto >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatPct(pronosticos.cierreAnio.varNeto)} vs {currentYear - 1}</p>
                </div>
                {pronosticos.cierreAnio.renta > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Renta estimada (35%)</p>
                    <p className="text-lg font-bold text-orange-500">{formatCurrency(pronosticos.cierreAnio.renta)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Impuestos proyectados al cierre */}
        {(pronosticos.impuestosCierre.retefuente > 0 || pronosticos.impuestosCierre.reteica > 0 || pronosticos.impuestosCierre.gmf > 0) && (
          <div className="rounded-lg border bg-muted/30 p-4 mb-4">
            <p className="text-xs font-semibold text-foreground mb-3">Impuestos proyectados al 31 de diciembre</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              {pronosticos.impuestosCierre.retefuente > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Retefuente</p>
                  <p className="text-sm font-bold text-orange-500">{formatCurrency(pronosticos.impuestosCierre.retefuente)}</p>
                </div>
              )}
              {pronosticos.impuestosCierre.reteica > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reteica</p>
                  <p className="text-sm font-bold text-orange-500">{formatCurrency(pronosticos.impuestosCierre.reteica)}</p>
                </div>
              )}
              {pronosticos.impuestosCierre.gmf > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">4x1000 (GMF)</p>
                  <p className="text-sm font-bold text-orange-500">{formatCurrency(pronosticos.impuestosCierre.gmf)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabla mes a mes */}
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/60">
                <th className="text-left px-3 py-2 font-semibold">Mes</th>
                <th className="text-right px-3 py-2 font-semibold">Ingresos</th>
                <th className="text-right px-3 py-2 font-semibold">Egresos</th>
                <th className="text-right px-3 py-2 font-semibold">Neto</th>
              </tr>
            </thead>
            <tbody>
              {pronosticos.mesAMes.map((m, i) => (
                <tr key={i} className={`border-t border-border ${!m.esReal ? 'opacity-70' : ''}`}>
                  <td className="px-3 py-2 font-medium">
                    {m.mes} {!m.esReal && <span className="text-[10px] text-muted-foreground italic">(proy.)</span>}
                  </td>
                  <td className="text-right px-3 py-2 text-green-600">{formatCurrency(m.ingresos)}</td>
                  <td className="text-right px-3 py-2 text-red-500">{formatCurrency(m.egresos)}</td>
                  <td className={`text-right px-3 py-2 font-medium ${m.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(m.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground italic">
        * Proyecciones basadas en promedio histórico ponderado con tendencia lineal. Meses marcados (proy.) son estimaciones. No garantizan resultados futuros.
      </p>
    </div>
  );
}
