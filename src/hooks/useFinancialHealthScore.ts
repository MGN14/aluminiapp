import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  calculateFinancialHealthMetrics,
  getRecommendations,
  getScoreInterpretation,
  type HealthInvoice,
  type HealthTransaction,
  type HistoricalScore,
  type ScoreBreakdown,
  type ScoreDetails,
} from './financialHealthScoreUtils';

export type { HistoricalScore, ScoreBreakdown, ScoreDetails } from './financialHealthScoreUtils';
export { getRecommendations, getScoreInterpretation } from './financialHealthScoreUtils';

interface TransactionRow extends HealthTransaction {
  date: string;
}

interface InvoiceRow extends HealthInvoice {
  issue_date: string;
  status: string;
}

interface MatchRow {
  invoice_id: string;
  matched_amount: number;
  transaction_id: string;
}

const EMPTY_SCORES: ScoreBreakdown = {
  conciliacion: 0,
  facturacion: 0,
  impuestos: 0,
  cartera: 0,
  clasificacion: 0,
  total: 0,
};

const EMPTY_DETAILS: ScoreDetails = {
  conciliacion: { pct: 0, montoPendiente: 0, totalMovimientos: 0 },
  facturacion: { pct: 0, ingresosConFactura: 0, ingresosAnticipo: 0, totalIngresos: 0 },
  impuestos: { pct: 0, pctVentas: 0, pctCompras: 0, pctVinculados: 0 },
  cartera: {
    pct: 0,
    pctCartera: 0,
    pctAnticipos: 0,
    cuentasPorCobrar: 0,
    anticiposSinFactura: 0,
    facturacionTotal: 0,
    ingresosTotal: 0,
  },
  clasificacion: { pct: 0, completas: 0, total: 0 },
};

function getMonthFromDate(dateValue: string): number {
  return new Date(`${dateValue}T00:00:00`).getMonth() + 1;
}

export function useFinancialHealthScore(year: number, _month?: number) {
  const [scores, setScores] = useState<ScoreBreakdown | null>(null);
  const [details, setDetails] = useState<ScoreDetails | null>(null);
  const [history, setHistory] = useState<HistoricalScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(true);
  const [lastMonthWithData, setLastMonthWithData] = useState<number | null>(null);

  const calculate = useCallback(async () => {
    try {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setScores(null);
        setDetails(null);
        setHistory([]);
        setHasData(false);
        setLastMonthWithData(null);
        return;
      }

      const yearStart = `${year}-01-01`;
      const nextYearStart = `${year + 1}-01-01`;

      const [txResult, invoiceResult, matchesResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, date, responsible_id, invoice_id, notes, category_id, amount')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', yearStart)
          .lt('date', nextYearStart),
        supabase
          .from('invoices')
          .select('id, type, status, issue_date, total_amount')
          .eq('user_id', user.id)
          .eq('status', 'confirmed')
          .gte('issue_date', yearStart)
          .lt('issue_date', nextYearStart),
        supabase
          .from('invoice_transaction_matches')
          .select('invoice_id, matched_amount, transaction_id')
          .eq('user_id', user.id),
      ]);

      if (txResult.error) throw txResult.error;
      if (invoiceResult.error) throw invoiceResult.error;
      if (matchesResult.error) throw matchesResult.error;

      const transactions = (txResult.data ?? []) as TransactionRow[];
      const invoices = (invoiceResult.data ?? []) as InvoiceRow[];
      const matches = (matchesResult.data ?? []) as MatchRow[];

      const latestTxMonth = transactions.reduce((maxMonth, tx) => Math.max(maxMonth, getMonthFromDate(tx.date)), 0);
      const latestInvoiceMonth = invoices.reduce((maxMonth, invoice) => Math.max(maxMonth, getMonthFromDate(invoice.issue_date)), 0);
      const latestMonth = Math.max(latestTxMonth, latestInvoiceMonth) || null;

      setLastMonthWithData(latestMonth);
      setHasData(Boolean(latestMonth));

      if (!latestMonth) {
        setScores(EMPTY_SCORES);
        setDetails(EMPTY_DETAILS);
        setHistory([]);
        return;
      }

      const matchTransactionIds = Array.from(new Set(matches.map((match) => match.transaction_id).filter(Boolean)));
      const transactionDateById = new Map<string, string>();

      if (matchTransactionIds.length > 0) {
        const { data: matchTransactions, error: matchTransactionsError } = await supabase
          .from('transactions')
          .select('id, date')
          .eq('user_id', user.id)
          .in('id', matchTransactionIds);

        if (matchTransactionsError) throw matchTransactionsError;

        (matchTransactions ?? []).forEach((tx) => {
          transactionDateById.set(tx.id, tx.date);
        });
      }

      const matchesWithDates = matches
        .map((match) => ({
          invoice_id: match.invoice_id,
          matched_amount: match.matched_amount ?? 0,
          date: transactionDateById.get(match.transaction_id) ?? null,
        }))
        .filter((match): match is { invoice_id: string; matched_amount: number; date: string } => Boolean(match.date));

      const monthlyResults: Array<{ month: number; scores: ScoreBreakdown; details: ScoreDetails }> = [];

      for (let month = 1; month <= latestMonth; month += 1) {
        const rangeEndExclusive = month === 12
          ? `${year + 1}-01-01`
          : `${year}-${String(month + 1).padStart(2, '0')}-01`;

        const transactionsToDate = transactions.filter((tx) => tx.date < rangeEndExclusive);
        const invoicesToDate = invoices.filter((invoice) => invoice.issue_date < rangeEndExclusive);
        const salesInvoicesToDate = invoicesToDate.filter((invoice) => invoice.type === 'venta');
        const salesInvoiceIds = new Set(salesInvoicesToDate.map((invoice) => invoice.id));

        const matchedByInvoice = new Map<string, number>();
        matchesWithDates.forEach((match) => {
          if (match.date >= rangeEndExclusive) return;
          if (!salesInvoiceIds.has(match.invoice_id)) return;

          matchedByInvoice.set(
            match.invoice_id,
            (matchedByInvoice.get(match.invoice_id) ?? 0) + match.matched_amount
          );
        });

        const { scores: monthScores, details: monthDetails } = calculateFinancialHealthMetrics(
          transactionsToDate,
          invoicesToDate,
          salesInvoicesToDate,
          matchedByInvoice
        );

        monthlyResults.push({ month, scores: monthScores, details: monthDetails });
      }

      const current = monthlyResults[monthlyResults.length - 1];
      setScores(current?.scores ?? EMPTY_SCORES);
      setDetails(current?.details ?? EMPTY_DETAILS);

      const historyRows: HistoricalScore[] = monthlyResults.map((item) => ({
        month: item.month,
        year,
        score_total: item.scores.total,
        score_conciliacion: item.scores.conciliacion,
        score_facturacion: item.scores.facturacion,
        score_impuestos: item.scores.impuestos,
        score_cartera: item.scores.cartera,
        score_clasificacion: item.scores.clasificacion,
      }));

      setHistory(historyRows);

      const upsertRows = monthlyResults.map((item) => ({
        user_id: user.id,
        month: item.month,
        year,
        score_total: item.scores.total,
        score_conciliacion: item.scores.conciliacion,
        score_facturacion: item.scores.facturacion,
        score_impuestos: item.scores.impuestos,
        score_cartera: item.scores.cartera,
        score_clasificacion: item.scores.clasificacion,
        details: item.details as any,
        updated_at: new Date().toISOString(),
      }));

      if (upsertRows.length > 0) {
        await supabase
          .from('financial_health_scores')
          .upsert(upsertRows, { onConflict: 'user_id,month,year' });
      }
    } catch (error) {
      console.error('Error calculating financial health score:', error);
      setScores(EMPTY_SCORES);
      setDetails(EMPTY_DETAILS);
      setHistory([]);
      setHasData(false);
      setLastMonthWithData(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  const interpretation = useMemo(() => (scores ? getScoreInterpretation(scores.total) : null), [scores]);
  const recommendations = useMemo(() => (scores ? getRecommendations(scores) : []), [scores]);

  return {
    scores,
    details,
    history,
    loading,
    interpretation,
    recommendations,
    recalculate: calculate,
    hasData,
    lastMonthWithData,
  };
}
