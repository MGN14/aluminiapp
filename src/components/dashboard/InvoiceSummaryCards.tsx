import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Users } from 'lucide-react';

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
  // Facturación
  totalFacturadoVentas: number;
  totalFacturadoCompras: number;
  ventasCount: number;
  comprasCount: number;
  topClients: [string, number][];
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
  const [retefuenteManualPeriodTransactions, setRetefuenteManualPeriodTransactions] = useState<ManualTaxTransaction[]>([]);
  const [retefuenteManualYearTransactions, setRetefuenteManualYearTransactions] = useState<ManualTaxTransaction[]>([]);
  const [retefuenteCompraRate, setRetefuenteCompraRate] = useState(0);
  const [dianPaymentsIva, setDianPaymentsIva] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const startStr = periodStart.toISOString().split('T')[0];
      const endStr = periodEnd.toISOString().split('T')[0];
      const yearStartStr = `${year}-01-01`;
      const yearEndStr = `${year}-12-31`;

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

      const [
        periodResult,
        yearResult,
        settingsResult,
        cuatrimestreResult,
        dianResult,
        retefuenteManualPeriodResult,
        retefuenteManualYearResult,
      ] = await Promise.all([
        periodQuery,
        yearQuery,
        settingsQuery,
        cuatrimestreQuery,
        dianPaymentsQuery,
        retefuenteManualPeriodQuery,
        retefuenteManualYearQuery,
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

      setLoading(false);
    };
    fetchData();
  }, [periodStart, periodEnd, year, cuatrimestreStart, cuatrimestreEnd]);

  const metrics = useMemo((): InvoiceFiscalMetrics => {
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
    // IVA neto = generado - descontable - pagos DIAN (IVA a favor)
    const ivaNeto = ivaGenerado - ivaDescontable - dianPaymentsIva;

    // IVA YTD
    const ivaGeneradoYtd = ventasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaDescontableYtd = comprasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaNetoYtd = ivaGeneradoYtd - ivaDescontableYtd;

    const totalFacturadoVentas = ventas.reduce((s, i) => s + i.total_amount, 0);
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

    // Retefuente manual - transactions marked as without invoice but with withholding
    // Apply retefuente rate to manual transactions (they store the full egreso amount, not the withholding)
    const retefuenteManualMonth = retefuenteManualPeriodTransactions.reduce((s, t) => s + Math.round(Math.abs(t.amount ?? 0) * retefuenteCompraRate), 0);
    const retefuenteManualYear = retefuenteManualYearTransactions.reduce((s, t) => s + Math.round(Math.abs(t.amount ?? 0) * retefuenteCompraRate), 0);
    const retefuenteManualMonthCount = retefuenteManualPeriodTransactions.length;
    const retefuenteManualYearCount = retefuenteManualYearTransactions.length;

    // Top Clients
    const byClient = new Map<string, number>();
    ventas.forEach(i => {
      const name = i.counterparty_name || 'Sin nombre';
      byClient.set(name, (byClient.get(name) || 0) + i.total_amount);
    });
    const topClients = Array.from(byClient.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5) as [string, number][];

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
      totalFacturadoVentas, totalFacturadoCompras,
      ventasCount: ventas.length, comprasCount: compras.length,
      topClients,
    };
  }, [invoices, allYearInvoices, cuatrimestreInvoices, retefuenteCompraRate, dianPaymentsIva, retefuenteManualPeriodTransactions, retefuenteManualYearTransactions]);

  // Report metrics to parent
  useEffect(() => {
    if (onMetrics) onMetrics(metrics);
  }, [metrics, onMetrics]);

  if (loading || invoices.length === 0) return null;

  return (
    <>
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

      {/* Top Clientes */}
      {metrics.topClients.length > 0 && (
        <Card className="sm:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top Clientes (Ventas)
            </CardTitle>
            <div className="p-2 rounded-lg bg-accent/10">
              <Users className="h-4 w-4 text-accent" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.topClients.map(([name, total]) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate mr-2">{name}</span>
                  <span className="font-medium text-foreground whitespace-nowrap">{formatCurrency(total)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
