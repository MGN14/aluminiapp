import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Users, Receipt, Calendar, Info } from 'lucide-react';

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

export interface InvoiceFiscalMetrics {
  // IVA
  ivaGenerado: number; // IVA from sales invoices
  ivaDescontable: number; // IVA from purchase invoices
  ivaNeto: number; // ivaGenerado - ivaDescontable (positive = por pagar, negative = a favor)
  // IVA YTD
  ivaGeneradoYtd: number;
  ivaDescontableYtd: number;
  ivaNetoYtd: number;
  // ReteICA
  reteicaMonth: number;
  reteicaYear: number;
  reteicaMonthCount: number;
  reteicaYearCount: number;
  // Retefuente
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
  onMetrics?: (metrics: InvoiceFiscalMetrics) => void;
}

export default function InvoiceSummaryCards({ periodStart, periodEnd, periodLabel, year, onMetrics }: Props) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [allYearInvoices, setAllYearInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInvoices = async () => {
      const startStr = periodStart.toISOString().split('T')[0];
      const endStr = periodEnd.toISOString().split('T')[0];
      const yearStartStr = `${year}-01-01`;
      const yearEndStr = `${year}-12-31`;

      // Fetch period invoices and year invoices in parallel
      const [periodResult, yearResult] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status')
          .eq('status', 'confirmed')
          .gte('issue_date', startStr)
          .lte('issue_date', endStr)
          .order('issue_date', { ascending: false }),
        supabase
          .from('invoices')
          .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status')
          .eq('status', 'confirmed')
          .gte('issue_date', yearStartStr)
          .lte('issue_date', yearEndStr)
          .order('issue_date', { ascending: false }),
      ]);

      if (!periodResult.error && periodResult.data) setInvoices(periodResult.data);
      if (!yearResult.error && yearResult.data) setAllYearInvoices(yearResult.data);
      setLoading(false);
    };
    fetchInvoices();
  }, [periodStart, periodEnd, year]);

  const metrics = useMemo((): InvoiceFiscalMetrics => {
    const ventas = invoices.filter(i => i.type === 'venta');
    const compras = invoices.filter(i => i.type === 'compra');
    const ventasYear = allYearInvoices.filter(i => i.type === 'venta');
    const comprasYear = allYearInvoices.filter(i => i.type === 'compra');

    const totalFacturadoVentas = ventas.reduce((s, i) => s + i.total_amount, 0);
    const totalFacturadoCompras = compras.reduce((s, i) => s + i.total_amount, 0);
    
    // IVA period
    const ivaGenerado = ventas.reduce((s, i) => s + i.iva_amount, 0);
    const ivaDescontable = compras.reduce((s, i) => s + i.iva_amount, 0);
    const ivaNeto = ivaGenerado - ivaDescontable;

    // IVA YTD
    const ivaGeneradoYtd = ventasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaDescontableYtd = comprasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaNetoYtd = ivaGeneradoYtd - ivaDescontableYtd;

    // ReteICA - from sales invoices (sobre base gravable)
    const reteicaMonth = ventas.reduce((s, i) => s + (i.reteica_amount ?? 0), 0);
    const reteicaYear = ventasYear.reduce((s, i) => s + (i.reteica_amount ?? 0), 0);
    const reteicaMonthCount = ventas.filter(i => (i.reteica_amount ?? 0) > 0).length;
    const reteicaYearCount = ventasYear.filter(i => (i.reteica_amount ?? 0) > 0).length;

    // Retefuente - autoretefuente from sales + retefuente from purchases
    const retefuenteMonth = ventas.reduce((s, i) => s + (i.autoretefuente_amount ?? 0), 0);
    const retefuenteYear = ventasYear.reduce((s, i) => s + (i.autoretefuente_amount ?? 0), 0);
    const retefuenteMonthCount = ventas.filter(i => (i.autoretefuente_amount ?? 0) > 0).length;
    const retefuenteYearCount = ventasYear.filter(i => (i.autoretefuente_amount ?? 0) > 0).length;

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
      retefuenteMonth, retefuenteYear, retefuenteMonthCount, retefuenteYearCount,
      totalFacturadoVentas, totalFacturadoCompras,
      ventasCount: ventas.length, comprasCount: compras.length,
      topClients,
    };
  }, [invoices, allYearInvoices]);

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
