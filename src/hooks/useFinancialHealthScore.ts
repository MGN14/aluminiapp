import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ScoreBreakdown {
  conciliacion: number;
  facturacion: number;
  impuestos: number;
  cartera: number;
  clasificacion: number;
  total: number;
}

export interface ScoreDetails {
  conciliacion: { pct: number; montoPendiente: number; totalMovimientos: number };
  facturacion: { pct: number; ingresosConFactura: number; ingresosAnticipo: number; totalIngresos: number };
  impuestos: { pct: number; pctVentas: number; pctCompras: number; pctVinculados: number };
  cartera: { pct: number; pctCartera: number; pctAnticipos: number; cuentasPorCobrar: number; anticiposSinFactura: number; facturacionTotal: number; ingresosTotal: number };
  clasificacion: { pct: number; completas: number; total: number };
}

export interface HistoricalScore {
  month: number;
  year: number;
  score_total: number;
  score_conciliacion: number;
  score_facturacion: number;
  score_impuestos: number;
  score_cartera: number;
  score_clasificacion: number;
}

// 6-tier scale used for conciliacion, facturacion, clasificacion
function sixTierScore(pct: number): number {
  if (pct >= 0.98) return 20;
  if (pct >= 0.95) return 18;
  if (pct >= 0.90) return 15;
  if (pct >= 0.80) return 10;
  if (pct >= 0.70) return 5;
  return 0;
}

// 5-tier scale used for impuestos
function fiveTierScore(pct: number): number {
  if (pct >= 0.95) return 20;
  if (pct >= 0.85) return 16;
  if (pct >= 0.70) return 12;
  if (pct >= 0.50) return 6;
  return 0;
}

// Cartera risk scale (lower is better)
function carteraScore(riesgo: number): number {
  if (riesgo <= 0.05) return 20;
  if (riesgo <= 0.10) return 18;
  if (riesgo <= 0.20) return 15;
  if (riesgo <= 0.30) return 10;
  if (riesgo <= 0.40) return 5;
  return 0;
}

export function getScoreInterpretation(score: number): { level: string; message: string; color: string } {
  if (score >= 90) return {
    level: 'Muy ordenado',
    message: 'Tu negocio tiene un alto nivel de organización financiera. La información disponible permitiría enfrentar una revisión tributaria con tranquilidad.',
    color: 'text-success',
  };
  if (score >= 75) return {
    level: 'Orden saludable',
    message: 'Tus finanzas están relativamente organizadas, pero aún existen algunos puntos que podrían generar inconsistencias si la información fuera revisada.',
    color: 'text-success',
  };
  if (score >= 60) return {
    level: 'Orden aceptable con riesgos',
    message: 'Tu negocio muestra desorden financiero en algunos aspectos. Es recomendable organizar tu información antes de que esto genere problemas fiscales o de control.',
    color: 'text-warning',
  };
  if (score >= 45) return {
    level: 'Riesgo alto',
    message: 'Tu negocio tiene un nivel de desorden financiero considerable. Si hoy recibieras una revisión de la DIAN, probablemente tendrías dificultades para soportar varias operaciones.',
    color: 'text-destructive',
  };
  return {
    level: 'Riesgo crítico',
    message: 'Tu negocio presenta un nivel de desorden financiero muy alto. En el estado actual sería difícil soportar adecuadamente los movimientos financieros ante una revisión de la DIAN. Es urgente organizar la información.',
    color: 'text-destructive',
  };
}

export function getRecommendations(scores: ScoreBreakdown): string[] {
  const recs: string[] = [];
  if (scores.conciliacion < 18) recs.push('Existen movimientos bancarios sin soporte. Revisa y vincula facturas, asigna responsables o clasifícalos correctamente.');
  if (scores.facturacion < 18) recs.push('Hay ingresos sin factura asociada ni marcados como anticipo. Esto puede generar inconsistencias frente a la DIAN.');
  if (scores.impuestos < 16) recs.push('La base fiscal del periodo está incompleta. Faltan facturas de compra o venta que afectan el cálculo del IVA y retenciones.');
  if (scores.cartera < 18) recs.push('Una parte importante de tu facturación no ha sido cobrada o tienes anticipos sin factura asociada.');
  if (scores.clasificacion < 18) recs.push('Varias transacciones no tienen categoría, responsable o factura asignada. Completa la información para mejorar tu orden.');
  return recs;
}

export function useFinancialHealthScore(year: number, month: number) {
  const [scores, setScores] = useState<ScoreBreakdown | null>(null);
  const [details, setDetails] = useState<ScoreDetails | null>(null);
  const [history, setHistory] = useState<HistoricalScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(true);

  const calculate = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

      // Fetch transactions
      const { data: txs } = await supabase
        .from('transactions')
        .select('id, responsible_id, invoice_id, notes, category_id, amount, type, has_iva')
        .is('deleted_at', null)
        .gte('date', monthStart)
        .lt('date', nextMonth);

      const transactions = txs || [];
      const totalTx = transactions.length;
      const hasTransactions = totalTx > 0;
      setHasData(hasTransactions);

      // ========== 1. CONCILIACIÓN BANCARIA (amount-based) ==========
      const totalMovimientos = transactions.reduce((s, tx) => s + Math.abs(tx.amount ?? 0), 0);
      const montoPendiente = transactions
        .filter(tx => !tx.responsible_id && !tx.invoice_id && !(tx.notes && (tx.notes.includes('[N/A]') || tx.notes.includes('[Anticipo]'))))
        .reduce((s, tx) => s + Math.abs(tx.amount ?? 0), 0);
      // If no transactions, score 0 (no data to evaluate)
      const pctConciliado = totalMovimientos > 0 ? 1 - (montoPendiente / totalMovimientos) : 0;
      const scoreConciliacion = hasTransactions ? sixTierScore(pctConciliado) : 0;

      // ========== 2. FACTURACIÓN SOPORTADA ==========
      const ingresosTx = transactions.filter(tx => (tx.amount ?? 0) > 0);
      const totalIngresosMonto = ingresosTx.reduce((s, tx) => s + (tx.amount ?? 0), 0);
      const ingresosConFacturaMonto = ingresosTx.filter(tx => !!tx.invoice_id).reduce((s, tx) => s + (tx.amount ?? 0), 0);
      const ingresosAnticipoMonto = ingresosTx.filter(tx => !tx.invoice_id && tx.notes && tx.notes.includes('[Anticipo]')).reduce((s, tx) => s + (tx.amount ?? 0), 0);
      const pctSoportado = totalIngresosMonto > 0 ? (ingresosConFacturaMonto + ingresosAnticipoMonto) / totalIngresosMonto : 0;
      const scoreFacturacion = hasTransactions ? sixTierScore(pctSoportado) : 0;

      // ========== 3. CONTROL DE IMPUESTOS ==========
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, type, status')
        .gte('issue_date', monthStart)
        .lt('issue_date', nextMonth);

      const allInvoices = (invoices || []).filter(i => i.status === 'confirmed');
      const ventasCount = allInvoices.filter(i => i.type === 'venta').length;
      const comprasCount = allInvoices.filter(i => i.type === 'compra').length;

      // % ingresos con factura de venta
      const ingresosConFacturaCount = ingresosTx.filter(tx => !!tx.invoice_id).length;
      const pctVentas = ingresosTx.length > 0 ? ingresosConFacturaCount / ingresosTx.length : (ventasCount > 0 ? 1 : 0);

      // % egresos con factura de compra
      const egresosTx = transactions.filter(tx => (tx.amount ?? 0) < 0);
      const egresosConFactura = egresosTx.filter(tx => !!tx.invoice_id).length;
      const pctCompras = egresosTx.length > 0 ? egresosConFactura / egresosTx.length : (comprasCount > 0 ? 1 : 0);

      // % movimientos relevantes con factura o N/A
      const relevantes = transactions.filter(tx => (tx.amount ?? 0) !== 0);
      const vinculados = relevantes.filter(tx => !!tx.invoice_id || (tx.notes && (tx.notes.includes('[N/A]') || tx.notes.includes('[Anticipo]')))).length;
      const pctVinculados = relevantes.length > 0 ? vinculados / relevantes.length : (hasTransactions ? 0 : 0);

      const hasAnyFiscalData = hasTransactions || allInvoices.length > 0;
      const completitudFiscal = hasAnyFiscalData ? (pctVentas + pctCompras + pctVinculados) / 3 : 0;
      const scoreImpuestos = hasAnyFiscalData ? fiveTierScore(completitudFiscal) : 0;

      // ========== 4. CARTERA Y ANTICIPOS ==========
      const { data: ventaInvoices } = await supabase
        .from('invoices')
        .select('id, total_amount, status')
        .eq('type', 'venta')
        .eq('status', 'confirmed')
        .gte('issue_date', monthStart)
        .lt('issue_date', nextMonth);

      const { data: matches } = await supabase
        .from('invoice_transaction_matches')
        .select('invoice_id, matched_amount');

      const matchMap = new Map<string, number>();
      (matches || []).forEach(m => {
        matchMap.set(m.invoice_id, (matchMap.get(m.invoice_id) || 0) + (m.matched_amount || 0));
      });

      const periodVentas = ventaInvoices || [];
      const facturacionTotal = periodVentas.reduce((s, i) => s + (i.total_amount || 0), 0);
      const cuentasPorCobrar = periodVentas.reduce((s, i) => {
        const paid = matchMap.get(i.id) || 0;
        return s + Math.max(0, (i.total_amount || 0) - paid);
      }, 0);
      const pctCartera = facturacionTotal > 0 ? cuentasPorCobrar / facturacionTotal : 0;

      // Anticipos sin factura
      const anticiposSinFactura = ingresosTx
        .filter(tx => !tx.invoice_id && tx.notes && tx.notes.includes('[Anticipo]'))
        .reduce((s, tx) => s + (tx.amount ?? 0), 0);
      const pctAnticipos = totalIngresosMonto > 0 ? anticiposSinFactura / totalIngresosMonto : 0;

      const riesgoTotal = (pctCartera + pctAnticipos) / 2;
      const scoreCartera = carteraScore(riesgoTotal);

      // ========== 5. CLASIFICACIÓN FINANCIERA ==========
      const completas = transactions.filter(tx => {
        const hasCat = !!tx.category_id;
        const hasResp = !!tx.responsible_id || (tx.notes && tx.notes.includes('[N/A]'));
        const hasInvoice = !!tx.invoice_id || (tx.notes && (tx.notes.includes('[N/A]') || tx.notes.includes('[Anticipo]')));
        return hasCat && hasResp && hasInvoice;
      }).length;
      const pctClasificado = totalTx > 0 ? completas / totalTx : 0;
      const scoreClasificacion = hasTransactions ? sixTierScore(pctClasificado) : 0;

      const total = scoreConciliacion + scoreFacturacion + scoreImpuestos + scoreCartera + scoreClasificacion;

      const breakdown: ScoreBreakdown = {
        conciliacion: scoreConciliacion,
        facturacion: scoreFacturacion,
        impuestos: scoreImpuestos,
        cartera: scoreCartera,
        clasificacion: scoreClasificacion,
        total,
      };

      const det: ScoreDetails = {
        conciliacion: { pct: pctConciliado, montoPendiente, totalMovimientos },
        facturacion: { pct: pctSoportado, ingresosConFactura: ingresosConFacturaMonto, ingresosAnticipo: ingresosAnticipoMonto, totalIngresos: totalIngresosMonto },
        impuestos: { pct: completitudFiscal, pctVentas, pctCompras, pctVinculados },
        cartera: { pct: riesgoTotal, pctCartera, pctAnticipos, cuentasPorCobrar, anticiposSinFactura, facturacionTotal, ingresosTotal: totalIngresosMonto },
        clasificacion: { pct: pctClasificado, completas, total: totalTx },
      };

      setScores(breakdown);
      setDetails(det);

      // Upsert to DB
      await supabase.from('financial_health_scores').upsert({
        user_id: user.id,
        month,
        year,
        score_total: total,
        score_conciliacion: scoreConciliacion,
        score_facturacion: scoreFacturacion,
        score_impuestos: scoreImpuestos,
        score_cartera: scoreCartera,
        score_clasificacion: scoreClasificacion,
        details: det as any,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,month,year' });

    } catch (error) {
      console.error('Error calculating financial health score:', error);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('financial_health_scores')
        .select('month, year, score_total, score_conciliacion, score_facturacion, score_impuestos, score_cartera, score_clasificacion')
        .eq('year', year)
        .order('month', { ascending: true });

      setHistory((data as HistoricalScore[]) || []);
    } catch (error) {
      console.error('Error fetching score history:', error);
    }
  }, [year]);

  useEffect(() => {
    calculate();
    fetchHistory();
  }, [calculate, fetchHistory]);

  const interpretation = useMemo(() => scores ? getScoreInterpretation(scores.total) : null, [scores]);
  const recommendations = useMemo(() => scores ? getRecommendations(scores) : [], [scores]);

  return { scores, details, history, loading, interpretation, recommendations, recalculate: calculate, hasData };
}
