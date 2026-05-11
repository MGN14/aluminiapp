import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getYearRangeExclusive } from '@/lib/dateUtils';
import {
  calculateFinancialHealthMetrics,
  getRecommendations,
  getScoreInterpretation,
  type HealthInventoryProduct,
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
  type?: string | null;
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
  impuestos: {
    pct: 0,
    ratioDescuadre: 0,
    totalDifferenceValue: 0,
    totalValueSiigo: 0,
    productsWithDiff: 0,
    totalProducts: 0,
  },
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

      const { start: yearStart, nextStart: nextYearStart } = getYearRangeExclusive(year);

      const [txResult, invoiceResult, matchesResult, initialStateResult, advanceDetailsResult, categoriesResult, responsiblesResult, allAdvanceDetailsResult, inventoryResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, date, responsible_id, invoice_id, notes, category_id, amount, type')
          .is('deleted_at', null)
          .gte('date', yearStart)
          .lt('date', nextYearStart),
        supabase
          .from('invoices')
          .select('id, type, status, issue_date, total_amount, retefuente_cliente_amount, void_type')
          .eq('status', 'confirmed')
          .gte('issue_date', yearStart)
          .lt('issue_date', nextYearStart),
        supabase
          .from('invoice_transaction_matches')
          .select('invoice_id, matched_amount, transaction_id'),
        supabase
          .from('initial_financial_state' as any)
          .select('cuentas_por_cobrar, anticipos_de_clientes, saldo_bancos')
          .maybeSingle(),
        supabase
          .from('initial_state_details')
          .select('invoice_id, amount')
          .eq('field_type', 'anticipos_de_clientes')
          .not('invoice_id', 'is', null),
        supabase
          .from('categories')
          .select('id, name'),
        supabase
          .from('responsibles')
          .select('id, name'),
        supabase
          .from('initial_state_details')
          .select('id, invoice_id, amount, responsible_name')
          .eq('field_type', 'anticipos_de_clientes'),
        supabase
          .from('inventory_products')
          .select('stock_system, stock_physical, cost_per_unit, active')
          .eq('active', true),
      ]);

      if (txResult.error) throw txResult.error;
      if (invoiceResult.error) throw invoiceResult.error;
      if (matchesResult.error) throw matchesResult.error;
      if (initialStateResult.error) throw initialStateResult.error;
      if (advanceDetailsResult.error) throw advanceDetailsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (responsiblesResult.error) throw responsiblesResult.error;
      if (allAdvanceDetailsResult.error) throw allAdvanceDetailsResult.error;
      if (inventoryResult.error) throw inventoryResult.error;

      const initialState = (initialStateResult.data as any) ?? null;
      const advanceDetails = ((advanceDetailsResult.data || []) as any[]);
      const allAdvanceDetails = ((allAdvanceDetailsResult.data || []) as any[]);
      // Inventory is a current snapshot (no historical reconstruction per month).
      // Same snapshot is passed to every month's calc — the inventory score component
      // therefore remains constant across the year until the user updates inventory.
      const inventoryProducts = ((inventoryResult.data || []) as any[]) as HealthInventoryProduct[];

      // Build category name map for advances calculation
      const categoryNameById = new Map<string, string>();
      ((categoriesResult.data || []) as any[]).forEach((c: any) => categoryNameById.set(c.id, c.name));

      // Build responsible name map
      const respNameById = new Map<string, string>();
      ((responsiblesResult.data || []) as any[]).forEach((r: any) => respNameById.set(r.id, r.name));

      const transactions = (txResult.data ?? []) as TransactionRow[];
      const invoices = (invoiceResult.data ?? []) as InvoiceRow[];
      const matches = (matchesResult.data ?? []) as MatchRow[];

      const latestTxMonth = transactions.reduce((maxMonth, tx) => Math.max(maxMonth, getMonthFromDate(tx.date)), 0);
      const latestInvoiceMonth = invoices.reduce((maxMonth, invoice) => Math.max(maxMonth, getMonthFromDate(invoice.issue_date)), 0);
      const latestMonth = Math.max(latestTxMonth, latestInvoiceMonth) || null;

      setLastMonthWithData(latestMonth);
      setHasData(Boolean(latestMonth));

      if (!latestMonth) {
        setScores(null);
        setDetails(null);
        setHistory([]);
        return;
      }

      const matchTransactionIds = Array.from(new Set(matches.map((match) => match.transaction_id).filter(Boolean)));
      const transactionDateById = new Map<string, string>();

      if (matchTransactionIds.length > 0) {
        const { data: matchTransactions, error: matchTransactionsError } = await supabase
          .from('transactions')
          .select('id, date')
          .is('deleted_at', null)
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
        // Excluir facturas totalmente anuladas por nota crédito: ya no son
        // facturación válida (Siigo las sigue exponiendo pero no cuentan).
        const invoicesToDate = invoices.filter(
          (invoice) => invoice.issue_date < rangeEndExclusive && invoice.void_type !== 'total',
        );
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

        // Include linked advance payments from initial_state_details
        advanceDetails.forEach((ad: any) => {
          if (ad.invoice_id && salesInvoiceIds.has(ad.invoice_id)) {
            matchedByInvoice.set(
              ad.invoice_id,
              (matchedByInvoice.get(ad.invoice_id) ?? 0) + Math.abs(ad.amount ?? 0)
            );
          }
        });

        // Include direct transaction payments (transactions with invoice_id linked to sales invoices)
        transactionsToDate.forEach((tx) => {
          if (tx.invoice_id && salesInvoiceIds.has(tx.invoice_id) && (tx.amount ?? 0) > 0) {
            matchedByInvoice.set(
              tx.invoice_id,
              (matchedByInvoice.get(tx.invoice_id) ?? 0) + Math.abs(tx.amount ?? 0)
            );
          }
        });

        // Calculate unlinked initial anticipos (only those without invoice_id)
        const linkedAnticiposAmount = advanceDetails.reduce((sum: number, ad: any) => sum + Math.abs(ad.amount ?? 0), 0);
        const unlinkedAnticiposClientes = Math.max(0, (initialState?.anticipos_de_clientes ?? 0) - linkedAnticiposAmount);

        // Calculate current period anticipos matching advances report logic:
        // ingreso + category "Ventas" + has responsible (not "Otros") + no invoice_id
        const currentPeriodAnticipos = transactionsToDate
          .filter((tx) => {
            if ((tx.amount ?? 0) <= 0) return false; // only ingresos
            if (tx.invoice_id) return false; // no invoice linked
            if (!tx.responsible_id) return false; // must have responsible
            const catName = tx.category_id ? (categoryNameById.get(tx.category_id) ?? '') : '';
            if (catName.toLowerCase() !== 'ventas') return false;
            const respName = respNameById.get(tx.responsible_id) ?? '';
            if (respName.toLowerCase() === 'otros') return false;
            return true;
          })
          .reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0);

        // Unlinked initial details amount
        const unlinkedInitialAmount = allAdvanceDetails
          .filter((d: any) => !d.invoice_id)
          .reduce((sum: number, d: any) => sum + Math.abs(d.amount ?? 0), 0);

        const totalCurrentPeriodAnticipos = currentPeriodAnticipos + unlinkedInitialAmount;

        // Gasto neto mensual = promedio (egresos − ingresos) últimos 3 meses
        // cerrados antes del mes actual. Si es positivo, está quemando plata
        // (necesario para el cálculo de runway en Pulmón financiero).
        const monthsLookback = 3;
        const ventanaInicio = new Date(year, month - 1 - monthsLookback, 1);
        const ventanaFin = new Date(year, month - 1, 1); // exclusive
        const ventanaInicioStr = `${ventanaInicio.getFullYear()}-${String(ventanaInicio.getMonth() + 1).padStart(2, '0')}-01`;
        const ventanaFinStr = `${ventanaFin.getFullYear()}-${String(ventanaFin.getMonth() + 1).padStart(2, '0')}-01`;
        const txVentana = transactions.filter(t => t.date >= ventanaInicioStr && t.date < ventanaFinStr);
        const ingresosVentana = txVentana
          .filter(t => (t.amount ?? 0) > 0)
          .reduce((s, t) => s + (t.amount ?? 0), 0);
        const egresosVentana = txVentana
          .filter(t => (t.amount ?? 0) < 0)
          .reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
        const gastoNetoMensual = (egresosVentana - ingresosVentana) / monthsLookback;

        const { scores: monthScores, details: monthDetails } = calculateFinancialHealthMetrics(
          transactionsToDate,
          invoicesToDate,
          salesInvoicesToDate,
          matchedByInvoice,
          initialState,
          unlinkedAnticiposClientes,
          totalCurrentPeriodAnticipos,
          inventoryProducts,
          gastoNetoMensual,
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
        const { error: upsertError } = await supabase
          .from('financial_health_scores')
          .upsert(upsertRows as any, { onConflict: 'user_id,month,year' });
        if (upsertError) {
          console.error('Error upserting financial health scores:', upsertError);
        }
      }
    } catch (error) {
      console.error('Error calculating financial health score:', error);
      setScores(null);
      setDetails(null);
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
