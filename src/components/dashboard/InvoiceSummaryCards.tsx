import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Users, Package, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { MONTH_LABELS } from '@/lib/constants';
import { rankAluminumReferencesByUnits, type TopReferenceRow } from '@/lib/topReferences';

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
  /** Top por UNIDADES, solo referencias de la maestra de aluminio. */
  topReferencesByUnits: TopReferenceRow[];
  totalUnidadesRef: number;
  /** True cuando el período no tenía ítems y se está mostrando el AÑO entero
   *  (los cards lo dicen en vez de mentir con el label del período). */
  itemsFromYearFallback: boolean;
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
  // Maestra de aluminio: filtra el ranking por unidades para que no lo ganen
  // tornillería (19.900 tornillos en una línea) ni vidrio (facturado en m²).
  const [aluminumRefs, setAluminumRefs] = useState<string[]>([]);
  // El período no tenía ítems y caímos al año entero (ver más abajo).
  const [itemsFromYearFallback, setItemsFromYearFallback] = useState(false);
  // IVA de importación pagado en aduana (import_costs tipo 'iva_importacion'):
  // es descontable igual que el IVA de una factura de compra. fecha = entrada
  // a aduana/entrega del contenedor (fallback: created_at del costo).
  const [importIvaRows, setImportIvaRows] = useState<{ fecha: string; montoCop: number }[]>([]);
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
        .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status, void_type')
        .eq('status', 'confirmed')
        .gte('issue_date', startStr)
        .lte('issue_date', endStr)
        .order('issue_date', { ascending: false });

      const yearQuery = supabase
        .from('invoices')
        .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status, void_type')
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

      // (Sin queries adicionales de tx con has_iva / has_retefuente: las
      // invoices DIAN son la fuente fiscal canónica. Sumar tx duplicaría.)

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
          .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status, void_type')
          .eq('status', 'confirmed')
          .gte('issue_date', cuatrimestreStart.toISOString().split('T')[0])
          .lte('issue_date', cuatrimestreEnd.toISOString().split('T')[0])
          .order('issue_date', { ascending: false });
      }

      // Previous month invoices query
      const prevMonthQuery = supabase
        .from('invoices')
        .select('id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, invoice_number, reteica_amount, autoretefuente_amount, status, void_type')
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

      // Filtro común: excluir facturas totalmente anuladas por nota crédito.
      // Las parciales siguen contando porque el saldo neto sigue siendo válido.
      // Cast a any porque el types generado de Supabase no reconoce void_type
      // hasta regenerarse (la columna se agregó en la migration 20260514).
      const stripVoided = (rows: any[] | null): any[] =>
        (rows ?? []).filter((r: any) => r?.void_type !== 'total');

      if (!periodResult.error && periodResult.data) setInvoices(stripVoided(periodResult.data as any));
      if (!yearResult.error && yearResult.data) setAllYearInvoices(stripVoided(yearResult.data as any));
      if (settingsResult?.data) setRetefuenteCompraRate(settingsResult.data.retefuente_compra_rate || 0);

      // Sum DIAN payments (these are negative amounts = egresos, we take abs value)
      if (dianResult && !dianResult.error && dianResult.data) {
        const total = dianResult.data.reduce((s: number, t: { amount: number | null }) => s + Math.abs(t.amount ?? 0), 0);
        setDianPaymentsIva(total);
      } else {
        setDianPaymentsIva(0);
      }

      if (cuatrimestreResult && !cuatrimestreResult.error && cuatrimestreResult.data) {
        setCuatrimestreInvoices(stripVoided(cuatrimestreResult.data as any));
      } else {
        setCuatrimestreInvoices([]);
      }

      if (!prevMonthResult.error && prevMonthResult.data) {
        setPrevMonthInvoices(stripVoided(prevMonthResult.data as any));
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

      // IVA de importación (contenedores) → IVA descontable. Antes NO sumaba
      // y el saldo a favor quedaba subestimado (pedido de Nico 2026-07-24).
      try {
        const { data: impIva } = await (supabase as any)
          .from('import_costs')
          .select('monto, moneda, trm, created_at, imports!inner(fecha_arribo_real, import_estado_history(estado, fecha))')
          .eq('tipo', 'iva_importacion');
        const rows = ((impIva ?? []) as Array<{
          monto: number; moneda: string; trm: number | null; created_at: string;
          imports: { fecha_arribo_real: string | null; import_estado_history?: { estado: string; fecha: string }[] };
        }>).map(r => {
          const hist = r.imports?.import_estado_history ?? [];
          const fecha = hist.find(h => h.estado === 'aduana')?.fecha
            ?? hist.find(h => h.estado === 'entregado')?.fecha
            ?? r.imports?.fecha_arribo_real
            ?? (r.created_at ?? '').slice(0, 10);
          const montoCop = r.moneda === 'COP'
            ? Number(r.monto) || 0
            : (Number(r.trm) > 0 ? (Number(r.monto) || 0) * Number(r.trm) : 0);
          return { fecha, montoCop };
        }).filter(r => r.fecha && r.montoCop > 0);
        setImportIvaRows(rows);
      } catch {
        setImportIvaRows([]);
      }

      // Fetch invoice items for top references:
      // Query by user_id + join invoices inline to filter by type/status/date.
      // This is more reliable than filtering by invoice_id list (avoids URL length limits
      // and works even when period invoices have no items but year invoices do).
      const yearSalesIds = ([
        ...(periodResult.data || []),
        ...(yearResult.data || []),
      ] as any[])
        .filter((i: any) => i?.type === 'venta' && i?.status === 'confirmed' && i?.void_type !== 'total')
        .map((i: any) => i.id as string)
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
        const periodIds = new Set(((periodResult.data as any[]) || []).filter((i: any) => i?.type === 'venta').map((i: any) => i.id as string));
        const periodItems = allItems.filter(item => periodIds.has((item as any).invoice_id));
        // Fall back to full year if period has no items. OJO: el fallback se
        // REPORTA (itemsFromYearFallback) para que los cards no digan el label
        // del período mostrando datos del año entero.
        const usingFallback = periodItems.length === 0 && allItems.length > 0;
        setItemsFromYearFallback(usingFallback);
        setInvoiceItems(usingFallback ? allItems : periodItems);
      } else {
        setInvoiceItems([]);
        setItemsFromYearFallback(false);
      }

      // Maestra de aluminio (paginada: PostgREST corta en 1000 en silencio).
      try {
        const refs: string[] = [];
        for (let from = 0; ; from += 1000) {
          const { data: prods, error: prodErr } = await supabase
            .from('inventory_products')
            .select('reference')
            .eq('active', true)
            .order('reference')
            .range(from, from + 999);
          if (prodErr) throw prodErr;
          const rows = (prods ?? []) as Array<{ reference: string | null }>;
          for (const r of rows) if (r.reference) refs.push(r.reference);
          if (rows.length < 1000) break;
        }
        setAluminumRefs(refs);
      } catch {
        // Sin maestra el ranking por unidades queda vacío (mejor eso que
        // mostrar tornillos como si fueran lo más vendido).
        setAluminumRefs([]);
      }

      setLoading(false);
    };
    fetchData();
  }, [periodStart, periodEnd, year, cuatrimestreStart, cuatrimestreEnd]);

  const metrics = useMemo((): Omit<InvoiceFiscalMetrics, 'topReferences' | 'totalBaseRef' | 'topReferencesByUnits' | 'totalUnidadesRef' | 'itemsFromYearFallback'> => {
    const ventas = invoices.filter(i => i.type === 'venta');
    const compras = invoices.filter(i => i.type === 'compra');
    const ventasYear = allYearInvoices.filter(i => i.type === 'venta');
    const comprasYear = allYearInvoices.filter(i => i.type === 'compra');

    // IVA solo desde invoices DIAN (status='confirmed'). NO sumar transactions
    // con has_iva: esas son el reflejo bancario del cobro de la misma factura,
    // contarlas duplica el IVA. Las invoices son la fuente fiscal canónica.
    //
    // ivaGenerado/ivaDescontable: del cuatrimestre actual (para mostrar detalle)
    const ivaSource = cuatrimestreInvoices.length > 0 ? cuatrimestreInvoices : invoices;
    const ivaVentas = ivaSource.filter(i => i.type === 'venta');
    const ivaCompras = ivaSource.filter(i => i.type === 'compra');
    const ivaGenerado = ivaVentas.reduce((s, i) => s + i.iva_amount, 0);

    // IVA de importación por período: descontable como el de una compra DIAN.
    const cuatriIni = cuatrimestreStart ? cuatrimestreStart.toISOString().split('T')[0] : null;
    const cuatriFin = cuatrimestreEnd ? cuatrimestreEnd.toISOString().split('T')[0] : null;
    const ivaImportCuatri = cuatriIni && cuatriFin
      ? importIvaRows.filter(r => r.fecha >= cuatriIni && r.fecha <= cuatriFin).reduce((s, r) => s + r.montoCop, 0)
      : 0;
    const ivaImportYtd = importIvaRows
      .filter(r => r.fecha.startsWith(String(year)))
      .reduce((s, r) => s + r.montoCop, 0);

    const ivaDescontable = ivaCompras.reduce((s, i) => s + i.iva_amount, 0) + ivaImportCuatri;

    // IVA YTD (acumulado del año): incluye implícitamente el saldo a favor
    // arrastrado de cuatrimestres anteriores. En Colombia, el saldo a favor de
    // un cuatrimestre se imputa al siguiente automáticamente (no se pierde).
    // Por eso ivaNeto = YTD, no del cuatrimestre aislado.
    const ivaGeneradoYtd = ventasYear.reduce((s, i) => s + i.iva_amount, 0);
    const ivaDescontableYtd = comprasYear.reduce((s, i) => s + i.iva_amount, 0) + ivaImportYtd;
    const ivaNetoYtd = ivaGeneradoYtd - ivaDescontableYtd;

    // ivaNeto que ve el dashboard: saldo VIVO (YTD acumulado, con arrastre).
    // Si ivaNeto > 0 → a pagar este cuatrimestre. Si < 0 → saldo a favor.
    const ivaNeto = ivaNetoYtd;

    const totalFacturadoVentas = ventas.reduce((s, i) => s + i.total_amount, 0);
    const totalBaseVentas = ventas.reduce((s, i) => s + i.subtotal_base, 0);
    const totalFacturadoCompras = compras.reduce((s, i) => s + i.total_amount, 0);

    // ReteICA - from sales invoices (única fuente para no duplicar con tx)
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

    // Retefuente manual (legacy): tx con notes='[Retefuente - Sin factura]' literal.
    // NO sumar has_retefuente directo porque esas tx son el pago bancario de
    // compras DIAN, y la retefuente_compra ya se calcula desde invoices compras
    // (subtotal_base × rate) — sumar tx duplicaría el cálculo.
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
  }, [invoices, allYearInvoices, cuatrimestreInvoices, prevMonthInvoices, retefuenteCompraRate, dianPaymentsIva, retefuenteManualPeriodTransactions, retefuenteManualYearTransactions, importIvaRows, cuatrimestreStart, cuatrimestreEnd, year]);

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

  // Top por UNIDADES — solo referencias de la maestra de aluminio, agrupadas
  // por referencia canónica. Lógica pura y testeada en lib/topReferences.
  const unitsRanking = useMemo(
    () => rankAluminumReferencesByUnits(invoiceItems, aluminumRefs),
    [invoiceItems, aluminumRefs],
  );

  // onMetrics reporting moved to render guard below

  const totalBaseRef = invoiceItems.reduce((s, item) => s + item.line_base, 0);

  // Always report metrics to parent even when loading or no invoices
  useEffect(() => {
    if (!loading && onMetrics) onMetrics({
      ...metrics,
      topReferences,
      totalBaseRef,
      topReferencesByUnits: unitsRanking.top,
      totalUnidadesRef: unitsRanking.totalUnidades,
      itemsFromYearFallback,
    });
  }, [loading, metrics, topReferences, totalBaseRef, unitsRanking, itemsFromYearFallback, onMetrics]);

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