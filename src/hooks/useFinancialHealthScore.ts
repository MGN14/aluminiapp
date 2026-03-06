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
  conciliacion: { ratio: number; conciliadas: number; total: number };
  facturacion: { ratio: number; conFactura: number; totalIngresos: number };
  impuestos: { level: string; facturasSinIVA: number; comprasSinFactura: number };
  cartera: { ratio: number; pendiente: number; totalFacturado: number };
  clasificacion: { ratio: number; clasificadas: number; total: number };
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

function ratioToScore(ratio: number): number {
  if (ratio >= 0.95) return 20;
  if (ratio >= 0.85) return 16;
  if (ratio >= 0.70) return 12;
  if (ratio >= 0.50) return 6;
  return 0;
}

export function getScoreInterpretation(score: number): { level: string; message: string; color: string } {
  if (score >= 90) return {
    level: 'Excelente',
    message: 'Tu negocio tiene un alto nivel de organización financiera. La información disponible permitiría enfrentar una revisión tributaria con tranquilidad.',
    color: 'text-success',
  };
  if (score >= 75) return {
    level: 'Saludable',
    message: 'Tus finanzas están relativamente organizadas, pero aún existen algunos puntos que podrían generar inconsistencias si la información fuera revisada.',
    color: 'text-success',
  };
  if (score >= 60) return {
    level: 'Riesgo moderado',
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
  if (scores.conciliacion < 16) recs.push('Existen transacciones bancarias sin soporte. Revisa y vincula facturas o clasifícalas correctamente.');
  if (scores.facturacion < 16) recs.push('Hay ingresos sin factura asociada. Esto puede generar inconsistencias frente a la DIAN.');
  if (scores.impuestos < 16) recs.push('Faltan facturas de compra o venta que afectan el cálculo del IVA.');
  if (scores.cartera < 16) recs.push('Una parte importante de tu facturación no ha sido cobrada.');
  if (scores.clasificacion < 16) recs.push('Varias transacciones no tienen categoría o responsable asignado.');
  return recs;
}

export function useFinancialHealthScore(year: number, month: number) {
  const [scores, setScores] = useState<ScoreBreakdown | null>(null);
  const [details, setDetails] = useState<ScoreDetails | null>(null);
  const [history, setHistory] = useState<HistoricalScore[]>([]);
  const [loading, setLoading] = useState(true);

  const calculate = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

      // Fetch transactions for the period
      const { data: txs } = await supabase
        .from('transactions')
        .select('id, responsible_id, invoice_id, notes, category_id, amount, type, has_iva')
        .is('deleted_at', null)
        .gte('date', monthStart)
        .lt('date', nextMonth);

      const transactions = txs || [];
      const totalTx = transactions.length;

      // 1. Conciliación Bancaria
      const conciliadas = transactions.filter(tx => {
        const hasResp = !!tx.responsible_id;
        const hasInvoice = !!tx.invoice_id;
        const hasTags = tx.notes && (tx.notes.includes('[N/A]') || tx.notes.includes('[Anticipo]'));
        return hasResp && (hasInvoice || hasTags);
      }).length;
      const concRatio = totalTx > 0 ? conciliadas / totalTx : 0;
      const scoreConciliacion = ratioToScore(concRatio);

      // 2. Facturación Soportada
      const ingresosTx = transactions.filter(tx => (tx.amount ?? 0) > 0);
      const ingresosConFactura = ingresosTx.filter(tx => !!tx.invoice_id).length;
      const totalIngresosTx = ingresosTx.length;
      const factRatio = totalIngresosTx > 0 ? ingresosConFactura / totalIngresosTx : 1;
      const scoreFacturacion = ratioToScore(factRatio);

      // 3. Control de Impuestos
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, type, iva_amount, status')
        .gte('issue_date', monthStart)
        .lt('issue_date', nextMonth);

      const allInvoices = invoices || [];
      const confirmedInvoices = allInvoices.filter(i => i.status === 'confirmed');
      const ventasConIVA = confirmedInvoices.filter(i => i.type === 'venta' && (i.iva_amount ?? 0) > 0).length;
      const totalVentas = confirmedInvoices.filter(i => i.type === 'venta').length;
      const totalCompras = confirmedInvoices.filter(i => i.type === 'compra').length;
      
      let scoreImpuestos = 0;
      let impLevel = 'información insuficiente';
      if (totalVentas > 0 && totalCompras > 0 && ventasConIVA === totalVentas) {
        scoreImpuestos = 20; impLevel = 'completa';
      } else if (totalVentas > 0 && totalCompras > 0) {
        scoreImpuestos = 16; impLevel = 'faltan pocas';
      } else if (totalVentas > 0 || totalCompras > 0) {
        scoreImpuestos = 12; impLevel = 'faltan varias';
      } else if (transactions.some(tx => tx.has_iva)) {
        scoreImpuestos = 6; impLevel = 'incompletos';
      }

      // 4. Cartera y Anticipos
      const { data: ventaInvoices } = await supabase
        .from('invoices')
        .select('id, total_amount, status')
        .eq('type', 'venta')
        .eq('status', 'confirmed')
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);

      const { data: matches } = await supabase
        .from('invoice_transaction_matches')
        .select('invoice_id, matched_amount');

      const matchMap = new Map<string, number>();
      (matches || []).forEach(m => {
        matchMap.set(m.invoice_id, (matchMap.get(m.invoice_id) || 0) + (m.matched_amount || 0));
      });

      const allVentas = ventaInvoices || [];
      const totalFacturado = allVentas.reduce((s, i) => s + (i.total_amount || 0), 0);
      const pendiente = allVentas.reduce((s, i) => {
        const paid = matchMap.get(i.id) || 0;
        return s + Math.max(0, (i.total_amount || 0) - paid);
      }, 0);
      const carteraRatio = totalFacturado > 0 ? pendiente / totalFacturado : 0;
      let scoreCartera = 0;
      if (carteraRatio < 0.10) scoreCartera = 20;
      else if (carteraRatio <= 0.20) scoreCartera = 16;
      else if (carteraRatio <= 0.35) scoreCartera = 12;
      else if (carteraRatio <= 0.50) scoreCartera = 6;

      // 5. Clasificación Financiera
      const clasificadas = transactions.filter(tx => !!tx.category_id && !!tx.responsible_id).length;
      const clasRatio = totalTx > 0 ? clasificadas / totalTx : 0;
      const scoreClasificacion = ratioToScore(clasRatio);

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
        conciliacion: { ratio: concRatio, conciliadas, total: totalTx },
        facturacion: { ratio: factRatio, conFactura: ingresosConFactura, totalIngresos: totalIngresosTx },
        impuestos: { level: impLevel, facturasSinIVA: totalVentas - ventasConIVA, comprasSinFactura: totalCompras === 0 ? 1 : 0 },
        cartera: { ratio: carteraRatio, pendiente, totalFacturado },
        clasificacion: { ratio: clasRatio, clasificadas, total: totalTx },
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

  return { scores, details, history, loading, interpretation, recommendations, recalculate: calculate };
}
