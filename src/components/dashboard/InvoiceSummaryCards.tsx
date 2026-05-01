import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Users, Package, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { MONTH_LABELS } from '@/lib/constants';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface InvoiceRow {
  id: string;
  type: string;
  issue_date: string;
  subtotal_base: number;
  iva_amount: number;
  total_amount: number;
  counterparty_name: string | null;
  invoice_number: string;
  reteica_amount: number | null;
  autoretefuente_amount: number | null;
  status: string;
}

interface ManualTaxTransaction {
  id: string;
  amount: number | null;
}

interface InvoiceItemRow {
  description: string | null;
  reference: string | null;
  quantity: number;
  line_base: number;
  line_total: number;
  invoice_id?: string;
}

export interface InvoiceFiscalMetrics {
  // IVA (cuatrimestre)
  ivaGenerado: number;
  ivaDescontable: number;
  ivaNeto: number;
  // IVA YTD
  ivaGeneradoYtd: number;
  ivaDescontableYtd: number;
  ivaNetoYtd: number;
  // ReteICA
  reteicaMonth: number;
  reteicaYear: number;
  reteicaMonthCount: number;
  reteicaYearCount: number;
  // Autorretefuente (ventas)
  autoretefuenteMonth: number;
  autoretefuenteYear: number;
  autoretefuenteMonthCount: number;
  autoretefuenteYearCount: number;
  // Retefuente compras (calculated from settings)
  retefuenteCompraMonth: number;
  retefuenteCompraYear: number;
  retefuenteCompraMonthCount: number;
  retefuenteCompraYearCount: number;
  // Retefuente manual (egresos sin factura)
  retefuenteManualMonth: number;
  retefuenteManualYear: number;
  retefuenteManualMonthCount: number;
  retefuenteManualYearCount: number;
  // Legacy combined (for backward compat)
  retefuenteMonth: number;
  retefuenteYear: number;
  retefuenteMonthCount: number;
  retefuenteYearCount: number;
  // Next payment (previous calendar month)
  retefuenteNextPayment: number;
  reteicaNextPayment: number;
  nextPaymentMonthLabel: string;
  // Facturación
  totalFacturadoVentas: number;
  totalBaseVentas: number;
  totalFacturadoCompras: number;
  ventasCount: number;
  comprasCount: number;
  topClients: [string, number][];
  topReferences: [string, { total: number; qty: number }][];
  totalBaseRef: number;
}

interface Props {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  year: number;
  cuatrimestreStart?: Date;
  cuatrimestreEnd?: Date;
  onMetrics?: (metrics: InvoiceFiscalMetrics) => void;
}

export default function InvoiceSummaryCards({ periodStart, periodEnd, periodLabel, year, cuatrimestreStart, cuatrimestreEnd, onMetrics }: Props) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [allYearInvoices, setAllYearInvoices] = useState<InvoiceRow[]>([]);
  const [cuatrimestreInvoices, setCuatrimestreInvoices] = useState<InvoiceRow[]>([]);
  const [prevMonthInvoices, setPrevMonthInvoices] = useState<InvoiceRow[]>([]);
  const [retefuenteManualPeriodTransactions, setRetefuenteManualPeriodTransactions] = useState<ManualTaxTransaction[]>([]);
  const [retefuenteManualYearTransactions, setRetefuenteManualYearTransactions] = useState<ManualTaxTransaction[]>([]);
  const [retefuenteCompraRate, setRetefuenteCompraRate] = useState(0);
  const [dianPaymentsIva, setDianPaymentsIva] = useState(0);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const startStr = periodStart.toISOString().split('T')[0];
      const endStr = periodEnd.toISOString().split('T')[0];
      const yearStartStr = `${year}-01-01`;
      const yearEndStr = `${year}-12-31`;

      // Previous calendar month (always relative to today, not the filter)
      const now = new Date();
      const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12
      const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const prevMonthStart = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const prevMonthEndDate = new Date(prevMonthYear, prevMonth, 0);
      const prevMonthEnd = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-${String(prevMonthEndDate.getDate()).padStart(2, '0')}`;

      // Fetch all queries in parallel
      const periodQuery = supabase
        .from('invoices')
        .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status')
        .eq('status', 'confirmed')
        .gte('issue_date', startStr)
        .lte('issue_date', endStr)
        .order('issue_date', { ascending: false });

      const yearQuery = supabase
        .from('invoices')
        .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status')
        .eq('status', 'confirmed')
        .gte('issue_date', yearStartStr)
        .lte('issue_date', yearEndStr)
        .order('issue_date', { ascending: false });

      const settingsQuery = supabase.from('tax_settings').select('retefuente_compra_rate').limit(1).maybeSingle();

      const retefuenteManualPeriodQuery = supabase
        .from('transactions')
        .select('id, amount')
        .eq('notes', '[Retefuente - Sin factura]')
        .is('deleted_at', null)
        .gte('date', startStr)
        .lte('date', endStr);

      const retefuenteManualYearQuery = supabase
        .from('transactions')
        .select('id, amount')
        .eq('notes', '[Retefuente - Sin factura]')
        .is('deleted_at', null)
        .gte('date', yearStartStr)
        .lte('date', yearEndStr);

      // Query DIAN payments (IVA a favor) from transactions in the cuatrimestre
      const dianPaymentsQuery = cuatrimestreStart && cuatrimestreEnd
        ? supabase
            .from('transactions')
            .select('amount')
            .eq('notes', '[IVA a favor - Pago DIAN]')
            .is('deleted_at', null)
            .gte('date', cuatrimestreStart.toISOString().split('T')[0])
            .lte('date', cuatrimestreEnd.toISOString().split('T')[0])
        : null;

      let cuatrimestreQuery = null;
      if (cuatrimestreStart && cuatrimestreEnd) {
        cuatrimestreQuery = supabase
          .from('invoices')
          .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status')
          .eq('status', 'confirmed')
          .gte('issue_date', cuatrimestreStart.toISOString().split('T')[0])
          .lte('issue_date', cuatrimestreEnd.toISOString().split('T')[0])
          .order('issue_date', { ascending: false });
      }

      // Previous month invoices query
      const prevMonthQuery = supabase
        .from('invoices')
        .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status')
        .eq('status', 'confirmed')
        .gte('issue_date', prevMonthStart)
        .lte('issue_date', prevMonthEnd);

      const [
        periodResult,
        yearResult,
        settingsResult,
        cuatrimestreResult,
        dianResult,
        retefuenteManualPeriodResult,
        retefuenteManualYearResult,
        prevMonthResult,
      ] = await Promise.all([
        periodQuery,
        yearQuery,
        settingsQuery,
        cuatrimestreQuery,
        dianPaymentsQuery,
        retefuenteManualPeriodQuery,
        retefuenteManualYearQuery,
        prevMonthQuery,
      ]);

      if (!periodResult.error && periodResult.data) setInvoices(periodResult.data);
      if (!yearResult.error && yearResult.data) setAllYearInvoices(yearResult.data);
      if (settingsResult?.data) setRetefuenteCompraRate(settingsResult.data.retefuente_compra_rate || 0);
      
      // Sum DIAN payments (these are negative amounts = egresos, we take abs value)
      if (dianResult && !dianResult.error && dianResult.data) {
        const total = dianResult.data.reduce((s: number, t: { amount: number | null }) => s + Math.abs(t.amount ?? 0), 0);
        setDianPaymentsIva(total);
      } else {
        setDianPaymentsIva(0);
      }
      
      if (cuatrimestreResult && !cuatrimestreResult.error && cuatrimestreResult.data) {
        setCuatrimestreInvoices(cuatrimestreResult.data);
      } else {
        setCuatrimestreInvoices([]);
      }

      if (!prevMonthResult.error && prevMonthResult.data) {
        setPrevMonthInvoices(prevMonthResult.data);
      } else {
        setPrevMonthInvoices([]);
      }

      if (!retefuenteManualPeriodResult.error && retefuenteManualPeriodResult.data) {
        setRetefuenteManualPeriodTransactions(retefuenteManualPeriodResult.data);
      } else {
        setRetefuenteManualPeriodTransactions([]);
      }

      if (!retefuenteManualYearResult.error && retefuenteManualYearResult.data) {
        setRetefuenteManualYearTransactions(retefuenteManualYearResult.data);
      } else {
        setRetefuenteManualYearTransactions([]);
      }

      // Fetch invoice items for top references:
      // Query by user_id + join invoices inline to filter by type/status/date.
      // This is more reliable than filtering by invoice_id list (avoids URL length limits
      // and works even when period invoices have no items but year invoices do).
      const yearSalesIds = [
        ...(periodResult.data || []),
        ...(yearResult.data || []),
      ]
        .filter(i => i.type === 'venta' && i.status === 'confirmed')
        .map(i => i.id)
        .filter((id, idx, arr) => arr.indexOf(id) === idx); // dedupe

      if (yearSalesIds.length > 0) {
        // Batch into chunks of 50 to avoid URL length limits
        const chunkSize = 50;
        const allItems: InvoiceItemRow[] = [];
        for (let i = 0; i < yearSalesIds.length; i += chunkSize) {
          const chunk = yearSalesIds.slice(i, i + chunkSize);
          const { data: chunkItems } = await supabase
            .from('invoice_items')
            .select('description, reference, quantity, line_base, line_total, invoice_id')
            .in('invoice_id', chunk);
          if (chunkItems) allItems.push(...(chunkItems as InvoiceItemRow[]));
        }
        // Filter to only period invoices for the card (use period + year depending on data)
        const periodIds = new Set((periodResult.data || []).filter(i => i.type === 'venta').map(i => i.id));
        const periodItems = allItems.filter(item => periodIds.has((item as any).invoice_id));
        // Fall back to full year if period has no items
        setInvoiceItems(periodItems.length > 0 ? periodItems : allItems);
      } else {
        setInvoiceItems([]);
      }

      setLoading(false);
    };
    fetchData();
  }, [periodStart, periodEnd, year, cuatrimestreStart, cuatrimestreEnd]);

  const metrics = useMemo((): Omit<InvoiceFiscalMetrics, 'topReferences' | 'totalBaseRef'> => {
    const ventas = invoices.filter(i => i.type === 'venta');
    const compras = invoices.filter(i => i.type === 'compra');
    const ventasYear = allYearInvoices.filter(i => i.type === 'venta');
    const comprasYear = allYearInvoices.filter(i => i.type === 'compra');

    // IVA from cuatrimestre (or fallback to period)
    const ivaSource = cuatrimestreInvoices.length > 0 ? cuatrimestreInvoices : invoices;
    const ivaVentas = ivaSource.filter(i => i.type === 'venta');
    const ivaCompras = ivaSource.filter(i => i.type === 'compra');
    const ivaGenerado = ivaVentas.reduce((s, i) => s + i.iva_amount, 0);
    const ivaDescontable = ivaCompras.reduce((s, i) => s + i.iva_amount, 0);
    // IVA a favor = descontable (compras) - generado (ventas); negated for display logic
    const ivaNeto = ivaGenerado - ivaDescontable;

    // IVA YTD
    const ivaGeneradoYtd = ventasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaDescontableYtd = comprasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaNetoYtd = -(ivaDescontableYtd - ivaGeneradoYtd);

    const totalFacturadoVentas = ventas.reduce((s, i) => s + i.total_amount, 0);
    const totalBaseVentas = ventas.reduce((s, i) => s + i.subtotal_base, 0);
    const totalFacturadoCompras = compras.reduce((s, i) => s + i.total_amount, 0);

    // ReteICA - from sales invoices
    const reteicaMonth = ventas.reduce((s, i) => s + (i.reteica_amount ?? 0), 0);
    const reteicaYear = ventasYear.reduce((s, i) => s + (i.reteica_amount ?? 0), 0);
    const reteicaMonthCount = ventas.filter(i => (i.reteica_amount ?? 0) > 0).length;
    const reteicaYearCount = ventasYear.filter(i => (i.reteica_amount ?? 0) > 0).length;

    // Autorretefuente - from sales invoices
    const autoretefuenteMonth = ventas.reduce((s, i) => s + (i.autoretefuente_amount ?? 0), 0);
    const autoretefuenteYear = ventasYear.reduce((s, i) => s + (i.autoretefuente_amount ?? 0), 0);
    const autoretefuenteMonthCount = ventas.filter(i => (i.autoretefuente_amount ?? 0) > 0).length;
    const autoretefuenteYearCount = ventasYear.filter(i => (i.autoretefuente_amount ?? 0) > 0).length;

    // Retefuente compras - calculated from purchase invoice base * rate from settings
    const retefuenteCompraMonth = compras.reduce((s, i) => s + Math.round(i.subtotal_base * retefuenteCompraRate), 0);
    const retefuenteCompraYear = comprasYear.reduce((s, i) => s + Math.round(i.subtotal_base * retefuenteCompraRate), 0);
    const retefuenteCompraMonthCount = retefuenteCompraRate > 0 ? compras.length : 0;
    const retefuenteCompraYearCount = retefuenteCompraRate > 0 ? comprasYear.length : 0;

    // Retefuente manual
    const retefuenteManualMonth = retefuenteManualPeriodTransactions.reduce((s, t) => s + Math.round(Math.abs(t.amount ?? 0) * retefuenteCompraRate), 0);
    const retefuenteManualYear = retefuenteManualYearTransactions.reduce((s, t) => s + Math.round(Math.abs(t.amount ?? 0) * retefuenteCompraRate), 0);
    const retefuenteManualMonthCount = retefuenteManualPeriodTransactions.length;
    const retefuenteManualYearCount = retefuenteManualYearTransactions.length;

    // Top Clients by subtotal_base
    const byClient = new Map<string, number>();
    ventas.forEach(i => {
      const name = i.counterparty_name || 'Sin nombre';
      byClient.set(name, (byClient.get(name) || 0) + i.subtotal_base);
    });
    const topClients = Array.from(byClient.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3) as [string, number][];

    // Next payment: previous calendar month (independent of filter)
    const prevMonthVentas = prevMonthInvoices.filter(i => i.type === 'venta');
    const prevMonthCompras = prevMonthInvoices.filter(i => i.type === 'compra');
    const retefuenteNextPayment =
      prevMonthVentas.reduce((s, i) => s + (i.autoretefuente_amount ?? 0), 0) +
      prevMonthCompras.reduce((s, i) => s + Math.round(i.subtotal_base * retefuenteCompraRate), 0);
    const reteicaNextPayment = prevMonthVentas.reduce((s, i) => s + (i.reteica_amount ?? 0), 0);

    const nowDate = new Date();
    const pm = nowDate.getMonth() === 0 ? 12 : nowDate.getMonth();
    const pmYear = nowDate.getMonth() === 0 ? nowDate.getFullYear() - 1 : nowDate.getFullYear();
    const nextPaymentMonthLabel = `${MONTH_LABELS[pm - 1]} ${pmYear}`;

    return {
      ivaGenerado, ivaDescontable, ivaNeto,
      ivaGeneradoYtd, ivaDescontableYtd, ivaNetoYtd,
      reteicaMonth, reteicaYear, reteicaMonthCount, reteicaYearCount,
      autoretefuenteMonth, autoretefuenteYear, autoretefuenteMonthCount, autoretefuenteYearCount,
      retefuenteCompraMonth, retefuenteCompraYear, retefuenteCompraMonthCount, retefuenteCompraYearCount,
      retefuenteManualMonth, retefuenteManualYear, retefuenteManualMonthCount, retefuenteManualYearCount,
      // Legacy combined
      retefuenteMonth: autoretefuenteMonth + retefuenteCompraMonth + retefuenteManualMonth,
      retefuenteYear: autoretefuenteYear + retefuenteCompraYear + retefuenteManualYear,
      retefuenteMonthCount: autoretefuenteMonthCount + retefuenteCompraMonthCount + retefuenteManualMonthCount,
      retefuenteYearCount: autoretefuenteYearCount + retefuenteCompraYearCount + retefuenteManualYearCount,
      retefuenteNextPayment, reteicaNextPayment, nextPaymentMonthLabel,
      totalFacturadoVentas, totalBaseVentas, totalFacturadoCompras,
      ventasCount: ventas.length, comprasCount: compras.length,
      topClients,
    };
  }, [invoices, allYearInvoices, cuatrimestreInvoices, prevMonthInvoices, retefuenteCompraRate, dianPaymentsIva, retefuenteManualPeriodTransactions, retefuenteManualYearTransactions]);

  // Top references from invoice items
  const topReferences = useMemo(() => {
    const byRef = new Map<string, { total: number; qty: number }>();
    invoiceItems.forEach(item => {
      const name = item.description || item.reference || 'Sin descripción';
      const existing = byRef.get(name) || { total: 0, qty: 0 };
      byRef.set(name, {
        total: existing.total + item.line_base,
        qty: existing.qty + item.quantity,
      });
    });
    return Array.from(byRef.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3);
  }, [invoiceItems]);

  // onMetrics reporting moved to render guard below

  const totalBaseRef = invoiceItems.reduce((s, item) => s + item.line_base, 0);

  // Always report metrics to parent even when loading or no invoices
  useEffect(() => {
    if (!loading && onMetrics) onMetrics({ ...metrics, topReferences, totalBaseRef });
  }, [loading, metrics, topReferences, totalBaseRef, onMetrics]);

  if (loading) return null;

  const RANK_COLORS = ['text-yellow-500', 'text-muted-foreground', 'text-amber-700'];

  // totalBaseRef already computed above

  return (
    <TooltipProvider>
      {/* Total Facturado Ventas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Facturado Ventas
          </CardTitle>
          <div className="p-2 rounded-lg bg-success/10">
            <FileText className="h-4 w-4 text-success" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-success">
            {formatCurrency(metrics.totalFacturadoVentas)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {metrics.ventasCount} factura{metrics.ventasCount !== 1 ? 's' : ''} • {periodLabel}
          </div>
        </CardContent>
      </Card>

      {/* Total Facturado Compras */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Facturado Compras
          </CardTitle>
          <div className="p-2 rounded-lg bg-destructive/10">
            <FileText className="h-4 w-4 text-destructive" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-destructive">
            {formatCurrency(metrics.totalFacturadoCompras)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {metrics.comprasCount} factura{metrics.comprasCount !== 1 ? 's' : ''} • {periodLabel}
          </div>
        </CardContent>
      </Card>

    </TooltipProvider>
  );
}