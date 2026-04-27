import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MONTH_NAMES } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { Receipt, AlertCircle, Info, Lightbulb, CheckCircle2, ChevronDown, ChevronRight, Banknote, ShieldCheck, History, Link2, Wallet } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import VincularPagoModal from './VincularPagoModal';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

interface PaymentDetail {
  type: 'transaction' | 'match' | 'advance' | 'retefuente';
  label: string;
  amount: number;
  date?: string;
}

interface InvoiceWithPayments {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  issue_date: string;
  total_amount: number;
  paid_amount: number;
  pending: number;
  days_since: number;
  status: 'pagada' | 'parcial' | 'pendiente';
  details: PaymentDetail[];
}

interface Suggestion {
  invoiceId: string;
  invoiceNumber: string;
  transactionId: string;
  transactionDesc: string;
  transactionAmount: number;
}

interface InitialCxCRow {
  id: string;
  responsible_name: string | null;
  amount: number;
  paid_amount: number;
  pending: number;
  details: PaymentDetail[];
}

interface VincularSaldoInicialTarget {
  id: string;
  responsible_name: string | null;
  pending: number;
  total_amount: number;
}

export default function AccountsReceivableReport() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const [year, setYear] = useState(currentYear);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [vincularInvoice, setVincularInvoice] = useState<InvoiceWithPayments | null>(null);
  const [vincularSaldoInicial, setVincularSaldoInicial] = useState<VincularSaldoInicialTarget | null>(null);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['accounts-receivable', user?.id, year],
    queryFn: async () => {
      if (!user) return null;

      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const [invoicesRes, initialDetailsRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, invoice_number, counterparty_name, issue_date, due_date, total_amount, subtotal_base, status, type, retefuente_cliente_amount, retefuente_cliente_rate, autoretefuente_amount, reteica_amount, dias_credito')
          .eq('user_id', user.id)
          .eq('type', 'venta')
          .gte('issue_date', startDate)
          .lte('issue_date', endDate)
          .order('issue_date', { ascending: false }),
        supabase
          .from('initial_state_details' as any)
          .select('*')
          .eq('user_id', user.id)
          .eq('field_type', 'cuentas_por_cobrar'),
      ]);

      const { data: invoices, error: invErr } = invoicesRes;
      const initialCxCDetails = (initialDetailsRes.data as any[]) || [];

      if (invErr) throw invErr;
      if (!invoices?.length && initialCxCDetails.length === 0) return { receivables: [], suggestions: [], initialCxC: 0, initialCxCRows: [] as InitialCxCRow[] };

      // Matches against initial balances (partial payments)
      const initialIds = initialCxCDetails.map((d: any) => d.id);
      let iniMatches: any[] = [];
      const iniMatchTxIds = new Set<string>();
      if (initialIds.length > 0) {
        const { data: iniMatchRes } = await supabase
          .from('initial_balance_matches' as any)
          .select('initial_state_detail_id, transaction_id, matched_amount')
          .eq('user_id', user.id)
          .in('initial_state_detail_id', initialIds);
        iniMatches = (iniMatchRes as any[]) || [];
        iniMatches.forEach((m: any) => iniMatchTxIds.add(m.transaction_id));
      }

      // Resolve tx descriptions/dates for initial-balance matches
      const iniMatchTxMap = new Map<string, { description: string; date: string }>();
      if (iniMatchTxIds.size > 0) {
        const { data: iniMatchTxs } = await supabase
          .from('transactions')
          .select('id, description, date')
          .in('id', [...iniMatchTxIds]);
        (iniMatchTxs || []).forEach((t: any) => iniMatchTxMap.set(t.id, { description: t.description, date: t.date }));
      }

      // Build per-initial-detail payment map
      const iniPaidByDetail = new Map<string, number>();
      const iniDetailsByDetail = new Map<string, PaymentDetail[]>();
      initialIds.forEach((id: string) => {
        iniPaidByDetail.set(id, 0);
        iniDetailsByDetail.set(id, []);
      });
      iniMatches.forEach((m: any) => {
        const amt = Math.abs(m.matched_amount ?? 0);
        const tx = iniMatchTxMap.get(m.transaction_id);
        iniPaidByDetail.set(m.initial_state_detail_id, (iniPaidByDetail.get(m.initial_state_detail_id) || 0) + amt);
        iniDetailsByDetail.get(m.initial_state_detail_id)?.push({
          type: 'match',
          label: tx?.description || 'Conciliación manual',
          amount: amt,
          date: tx?.date,
        });
      });

      const initialCxCRows: InitialCxCRow[] = initialCxCDetails.map((d: any) => {
        const paid = iniPaidByDetail.get(d.id) || 0;
        const pending = Math.max(0, (d.amount ?? 0) - paid);
        return {
          id: d.id,
          responsible_name: d.responsible_name,
          amount: d.amount ?? 0,
          paid_amount: paid,
          pending,
          details: iniDetailsByDetail.get(d.id) || [],
        };
      });

      const initialCxC = initialCxCRows.reduce((s, r) => s + r.pending, 0);

      const invoiceIds = invoices.map(i => i.id);

      const [directRes, matchRes, advanceRes, unmatchedRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, invoice_id, amount, description, date')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .in('invoice_id', invoiceIds),
        supabase
          .from('invoice_transaction_matches')
          .select('invoice_id, matched_amount, transaction_id')
          .eq('user_id', user.id)
          .in('invoice_id', invoiceIds),
        supabase
          .from('initial_state_details')
          .select('invoice_id, amount, responsible_name')
          .eq('user_id', user.id)
          .eq('field_type', 'anticipos_de_clientes')
          .in('invoice_id', invoiceIds),
        supabase
          .from('transactions')
          .select('id, amount, description, owner, responsible_id, date')
          .eq('user_id', user.id)
          .eq('type', 'ingreso')
          .is('invoice_id', null)
          .is('deleted_at', null)
          .gte('date', startDate)
          .lte('date', endDate),
      ]);

      // Get transaction dates for matches
      const matchTxIds = [...new Set((matchRes.data || []).map(m => m.transaction_id))];
      let matchTxMap = new Map<string, { description: string; date: string }>();
      if (matchTxIds.length > 0) {
        const { data: matchTxs } = await supabase
          .from('transactions')
          .select('id, description, date')
          .in('id', matchTxIds);
        (matchTxs || []).forEach(t => matchTxMap.set(t.id, { description: t.description, date: t.date }));
      }

      // Build per-invoice detail lists
      const detailsByInvoice = new Map<string, PaymentDetail[]>();
      const paymentsByInvoice = new Map<string, number>();

      invoiceIds.forEach(id => {
        detailsByInvoice.set(id, []);
        paymentsByInvoice.set(id, 0);
      });

      // Direct transaction payments
      (directRes.data || []).forEach(p => {
        if (!p.invoice_id) return;
        const amt = Math.abs(p.amount ?? 0);
        detailsByInvoice.get(p.invoice_id)?.push({
          type: 'transaction',
          label: p.description || 'Transacción directa',
          amount: amt,
          date: p.date,
        });
        paymentsByInvoice.set(p.invoice_id, (paymentsByInvoice.get(p.invoice_id) || 0) + amt);
      });

      // Match payments
      (matchRes.data || []).forEach(p => {
        const tx = matchTxMap.get(p.transaction_id);
        const amt = Math.abs(p.matched_amount);
        detailsByInvoice.get(p.invoice_id)?.push({
          type: 'match',
          label: tx?.description || 'Conciliación manual',
          amount: amt,
          date: tx?.date,
        });
        paymentsByInvoice.set(p.invoice_id, (paymentsByInvoice.get(p.invoice_id) || 0) + amt);
      });

      // Advance payments from initial state
      ((advanceRes.data || []) as any[]).forEach(p => {
        if (!p.invoice_id) return;
        const amt = Math.abs(p.amount ?? 0);
        detailsByInvoice.get(p.invoice_id)?.push({
          type: 'advance',
          label: `Anticipo periodo anterior — ${p.responsible_name || 'Sin nombre'}`,
          amount: amt,
        });
        paymentsByInvoice.set(p.invoice_id, (paymentsByInvoice.get(p.invoice_id) || 0) + amt);
      });

      const today = new Date();
      const receivables: InvoiceWithPayments[] = invoices.map(inv => {
        // No auto-paid shortcut: the "paid" amount must come from real
        // conciliations, matches or advances. A newly issued invoice stays
        // pendiente until bank reconciliation moves money against it.
        const rawPaid = paymentsByInvoice.get(inv.id) || 0;
        const paid = rawPaid;
        // Use the saved retefuente values from the invoice module directly
        // Only fall back to 2.5% if rate is null (never configured), not if explicitly 0
        const savedRetefuente = (inv as any).retefuente_cliente_amount ?? 0;
        const rawRate = (inv as any).retefuente_cliente_rate;
        const hasExplicitRate = rawRate !== null && rawRate !== undefined;
        const effectiveRate = hasExplicitRate ? rawRate : 0.025;
        const retefuenteCliente = savedRetefuente > 0
          ? savedRetefuente
          : Math.round((inv.subtotal_base ?? 0) * effectiveRate);
        const details = [...(detailsByInvoice.get(inv.id) || [])];

        // Always add retention as a detail line for sale invoices
        if (retefuenteCliente > 0) {
          const displayRate = savedRetefuente > 0 && rawRate > 0 ? (rawRate * 100).toFixed(1) : '2.5';
          details.push({
            type: 'retefuente',
            label: `Retefuente cliente ${displayRate}% (pagada a DIAN)`,
            amount: retefuenteCliente,
          });
        }

        const totalDeducted = paid + retefuenteCliente;
        const pending = Math.max(0, inv.total_amount - totalDeducted);
        const daysSince = differenceInDays(today, new Date(inv.issue_date));
        let status: 'pagada' | 'parcial' | 'pendiente' = 'pendiente';
        if (pending <= 0) status = 'pagada';
        else if (totalDeducted > 0) status = 'parcial';

        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          counterparty_name: inv.counterparty_name,
          issue_date: inv.issue_date,
          total_amount: inv.total_amount,
          paid_amount: totalDeducted,
          pending,
          days_since: daysSince,
          status,
          details,
        };
      });

      const unpaid = receivables.filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending);

      // Suggestions
      const suggestions: Suggestion[] = [];
      const TOLERANCE = 0.05;
      for (const inv of unpaid) {
        for (const tx of (unmatchedRes.data || [])) {
          const txAmount = Math.abs(tx.amount ?? 0);
          const diff = Math.abs(txAmount - inv.total_amount) / inv.total_amount;
          const ownerMatch = tx.owner && inv.counterparty_name &&
            tx.owner.toLowerCase().includes(inv.counterparty_name.toLowerCase().substring(0, 5));
          if (diff <= TOLERANCE || ownerMatch) {
            suggestions.push({
              invoiceId: inv.id,
              invoiceNumber: inv.invoice_number,
              transactionId: tx.id,
              transactionDesc: tx.description,
              transactionAmount: txAmount,
            });
          }
        }
      }

      return { receivables: unpaid, suggestions, allReceivables: receivables, initialCxC, initialCxCRows };
    },
    enabled: !!user,
  });

  const initialCxC = data?.initialCxC ?? 0;

  const totalPending = useMemo(() => {
    return (data?.receivables || []).reduce((s, r) => s + r.pending, 0) + initialCxC;
  }, [data, initialCxC]);

  // Solo en Gerencial: cobros en efectivo del año (ingresos manuales en
  // cash_movements). No se vinculan a una factura específica todavía — los
  // mostramos como una "bolsa" complementaria que ajusta la cartera real
  // estimada. Si el cliente cobró en efectivo, parte de su CxC oficial
  // está en realidad cobrada.
  const { data: cashIncomeYear } = useQuery({
    queryKey: ['ar-cash-income', user?.id, year, isGerencial],
    queryFn: async () => {
      if (!user || !isGerencial) return 0;
      const { data, error } = await supabase
        .from('cash_movements')
        .select('amount')
        .eq('user_id', user.id)
        .eq('type', 'ingreso')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`);
      if (error) return 0;
      return (data ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0);
    },
    enabled: !!user && isGerencial,
  });

  const cobrosEfectivo = cashIncomeYear ?? 0;
  // Cartera real estimada: cartera oficial menos cobros en efectivo, sin
  // bajar de cero. Es una heurística — se vuelve exacta cuando el cliente
  // vincula manualmente cada cobro a su factura desde Movimientos.
  const carteraReal = isGerencial
    ? Math.max(0, totalPending - cobrosEfectivo)
    : totalPending;

  const paidInvoices = useMemo(() => {
    return (data?.allReceivables || []).filter(r => r.pending <= 0);
  }, [data]);

  const [showPaid, setShowPaid] = useState(false);

  const handleAssociate = async (suggestion: Suggestion) => {
    if (!user) return;
    const { error } = await supabase
      .from('transactions')
      .update({ invoice_id: suggestion.invoiceId })
      .eq('id', suggestion.transactionId);

    if (error) {
      toast.error('Error al asociar la transacción');
      return;
    }
    toast.success(`Transacción asociada a factura #${suggestion.invoiceNumber}`);
    refetch();
  };


  const statusBadge = (status: 'pagada' | 'parcial' | 'pendiente') => {
    switch (status) {
      case 'pagada':
        return <Badge variant="outline" className="bg-success/10 text-success border-success/30">Pagada</Badge>;
      case 'parcial':
        return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Parcial</Badge>;
      case 'pendiente':
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Pendiente</Badge>;
    }
  };

  const detailIcon = (type: PaymentDetail['type']) => {
    switch (type) {
      case 'transaction': return <Banknote className="h-4 w-4 text-success" />;
      case 'match': return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'advance': return <History className="h-4 w-4 text-warning" />;
      case 'retefuente': return <ShieldCheck className="h-4 w-4 text-primary" />;
    }
  };

  const detailTypeBadge = (type: PaymentDetail['type']) => {
    const labels: Record<string, string> = {
      transaction: 'Pago',
      match: 'Conciliación',
      advance: 'Anticipo',
      retefuente: 'Retención',
    };
    const colors: Record<string, string> = {
      transaction: 'bg-success/10 text-success border-success/30',
      match: 'bg-success/10 text-success border-success/30',
      advance: 'bg-warning/10 text-warning border-warning/30',
      retefuente: 'bg-primary/10 text-primary border-primary/30',
    };
    return <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", colors[type])}>{labels[type]}</Badge>;
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header + filter */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Lo que me deben</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Facturas de venta emitidas con saldo pendiente de pago.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        {/* KPIs — en Gerencial mostramos cartera oficial + cobros en efectivo
            + cartera real estimada. En DIAN solo la oficial. */}
        <div className={isGerencial ? "grid grid-cols-1 md:grid-cols-3 gap-3" : ""}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isGerencial ? 'Cartera oficial (DIAN)' : 'Total de lo que me deben'}
              </CardTitle>
              <div className="p-2 rounded-lg bg-destructive/10">
                <Receipt className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{formatCurrency(totalPending)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data?.receivables.length ?? 0} factura{(data?.receivables.length ?? 0) !== 1 ? 's' : ''} pendientes • {year}
              </p>
            </CardContent>
          </Card>

          {isGerencial && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cobrado en efectivo</CardTitle>
                  <div className="p-2 rounded-lg bg-warning/10">
                    <Wallet className="h-4 w-4 text-warning" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">{formatCurrency(cobrosEfectivo)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Movimientos en efectivo tipo ingreso • {year}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-success/30 bg-success/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cartera real estimada</CardTitle>
                  <div className="p-2 rounded-lg bg-success/10">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">{formatCurrency(carteraReal)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cartera oficial − cobros en efectivo
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {isGerencial && cobrosEfectivo > 0 && (
          <Card className="border-warning/30 bg-warning/[0.04]">
            <CardContent className="py-3 px-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p>
                <span className="font-medium text-foreground">Cartera real es estimada.</span>{' '}
                Restamos los cobros en efectivo del total que muestra la DIAN, asumiendo que parte ya está cobrada.
                Para mayor precisión, vinculá cada movimiento en efectivo a su factura desde el módulo{' '}
                <span className="font-medium">Movimientos en efectivo</span>.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Suggestions */}
        {(data?.suggestions?.length ?? 0) > 0 && (
          <Card className="border-warning/30 bg-warning/5">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-warning" />
                <CardTitle className="text-sm font-medium">Sugerencias de conciliación</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {data!.suggestions!.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 p-2 rounded-md bg-card border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">
                      <span className="font-medium">#{s.invoiceNumber}</span>
                      <span className="text-muted-foreground"> ← </span>
                      <span className="text-muted-foreground truncate">{s.transactionDesc}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Monto transacción: {formatCurrency(s.transactionAmount)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1 text-xs"
                    onClick={() => handleAssociate(s)}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Asociar
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="font-semibold"># Factura</TableHead>
                    <TableHead className="font-semibold">Cliente</TableHead>
                    <TableHead className="font-semibold">Emisión</TableHead>
                    <TableHead className="font-semibold text-right">Total</TableHead>
                    <TableHead className="font-semibold text-right">Abonado</TableHead>
                    <TableHead className="font-semibold text-right">Pendiente</TableHead>
                    <TableHead className="font-semibold text-center">Días</TableHead>
                    <TableHead className="font-semibold text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                        Cargando datos...
                      </TableCell>
                    </TableRow>
                  ) : !data?.receivables?.length && !data?.initialCxCRows?.length ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">No hay facturas con saldo pendiente en {year}.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {/* Initial CxC balances per client */}
                      {(data?.initialCxCRows || []).filter((r) => r.pending > 0).map((detail) => {
                        const rowKey = `initial-${detail.id}`;
                        const isExpanded = expandedRows.has(rowKey);
                        const hasDetails = detail.details.length > 0;
                        const status: 'pagada' | 'parcial' | 'pendiente' = detail.pending <= 0
                          ? 'pagada'
                          : detail.paid_amount > 0 ? 'parcial' : 'pendiente';
                        return (
                          <React.Fragment key={rowKey}>
                            <TableRow
                              className={cn(
                                'bg-warning/5 border-l-2 border-l-warning cursor-pointer hover:bg-warning/10',
                                isExpanded && 'bg-warning/15'
                              )}
                              onClick={() => toggleRow(rowKey)}
                            >
                              <TableCell className="w-8 px-2">
                                {isExpanded
                                  ? <ChevronDown className="h-4 w-4 text-warning" />
                                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              </TableCell>
                              <TableCell className="text-sm font-medium text-warning">📋 Saldo inicial</TableCell>
                              <TableCell className="text-sm font-medium">{detail.responsible_name || 'Sin nombre'}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap text-muted-foreground">Periodo anterior</TableCell>
                              <TableCell className="text-right text-sm font-medium">{formatCurrency(detail.amount)}</TableCell>
                              <TableCell className="text-right text-sm text-success">{formatCurrency(detail.paid_amount)}</TableCell>
                              <TableCell className="text-right text-sm font-bold text-destructive">{formatCurrency(detail.pending)}</TableCell>
                              <TableCell className="text-center text-sm text-muted-foreground">—</TableCell>
                              <TableCell className="text-center">
                                {status === 'parcial'
                                  ? <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Parcial</Badge>
                                  : <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Histórico</Badge>}
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`${rowKey}-details`} className="hover:bg-transparent">
                                <TableCell colSpan={9} className="p-0">
                                  <div className="bg-warning/5 border-l-2 border-l-warning mx-0">
                                    <div className="px-6 py-4 space-y-3">
                                      <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                                        <Receipt className="h-4 w-4 text-warning" />
                                        Abonos a este saldo inicial
                                      </p>
                                      {hasDetails ? (
                                        <div className="space-y-2">
                                          {detail.details.map((d, idx) => (
                                            <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/60">
                                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/60 shrink-0">
                                                {detailIcon(d.type)}
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                  {detailTypeBadge(d.type)}
                                                  {d.date && (
                                                    <span className="text-xs text-muted-foreground">
                                                      {format(parseLocalDate(d.date), 'dd MMM yyyy', { locale: es })}
                                                    </span>
                                                  )}
                                                </div>
                                                <p className="text-sm text-foreground truncate">{d.label}</p>
                                              </div>
                                              <span className="text-sm font-bold whitespace-nowrap text-success">
                                                −{formatCurrency(d.amount)}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground italic">
                                          Aún no hay abonos vinculados a este saldo inicial.
                                        </p>
                                      )}
                                      {hasDetails && (
                                        <>
                                          <div className="flex items-center justify-between pt-3 border-t border-border">
                                            <span className="text-sm font-semibold text-muted-foreground">Total abonado</span>
                                            <span className="text-base font-bold text-success">−{formatCurrency(detail.paid_amount)}</span>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm font-semibold text-muted-foreground">Saldo pendiente</span>
                                            <span className="text-base font-bold text-destructive">{formatCurrency(detail.pending)}</span>
                                          </div>
                                        </>
                                      )}
                                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                                        <p className="text-xs text-muted-foreground">
                                          ¿Recibiste un pago bancario de este cliente histórico? Vinculalo al saldo.
                                        </p>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="shrink-0 gap-1 text-xs border-warning/40 text-warning hover:bg-warning/10"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setVincularSaldoInicial({
                                              id: detail.id,
                                              responsible_name: detail.responsible_name,
                                              pending: detail.pending,
                                              total_amount: detail.amount,
                                            });
                                          }}
                                        >
                                          <Link2 className="h-3.5 w-3.5" />
                                          Vincular pago
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {data.receivables.map((inv) => {
                      const isExpanded = expandedRows.has(inv.id);
                      const hasDetails = (inv.details?.length ?? 0) > 0;

                      return (
                        <React.Fragment key={inv.id}>
                          <TableRow
                            className={cn(
                              'cursor-pointer hover:bg-muted/50',
                              isExpanded && 'bg-muted/30 border-l-2 border-l-primary'
                            )}
                            onClick={() => toggleRow(inv.id)}
                          >
                            <TableCell className="w-8 px-2">
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4 text-primary" />
                                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              }
                            </TableCell>
                            <TableCell className="text-sm font-medium">{inv.invoice_number}</TableCell>
                            <TableCell className="text-sm">{inv.counterparty_name || 'Sin nombre'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es })}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {formatCurrency(inv.total_amount)}
                            </TableCell>
                            <TableCell className="text-right text-sm text-success">
                              {formatCurrency(inv.paid_amount)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-bold text-destructive">
                              {formatCurrency(inv.pending)}
                            </TableCell>
                            <TableCell className={cn(
                              "text-center text-sm font-medium",
                              inv.days_since > 90 ? 'text-destructive' : inv.days_since > 30 ? 'text-warning' : 'text-muted-foreground'
                            )}>
                              {inv.days_since}d
                            </TableCell>
                            <TableCell className="text-center">{statusBadge(inv.status)}</TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${inv.id}-details`} className="hover:bg-transparent">
                              <TableCell colSpan={9} className="p-0">
                                <div className="bg-muted/10 border-l-2 border-l-primary mx-0">
                                  <div className="px-6 py-4 space-y-3">
                                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                                      <Receipt className="h-4 w-4 text-primary" />
                                      Detalle de abonos y deducciones
                                    </p>
                                    {hasDetails ? (
                                      <div className="space-y-2">
                                        {(inv.details || []).map((d, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/60"
                                          >
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/60 shrink-0">
                                              {detailIcon(d.type)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 mb-0.5">
                                                {detailTypeBadge(d.type)}
                                                {d.date && (
                                                  <span className="text-xs text-muted-foreground">
                                                     {format(parseLocalDate(d.date), 'dd MMM yyyy', { locale: es })}
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-sm text-foreground truncate">{d.label}</p>
                                            </div>
                                            <span className={cn(
                                              "text-sm font-bold whitespace-nowrap",
                                              d.type === 'retefuente' ? 'text-primary' : 'text-success'
                                            )}>
                                              −{formatCurrency(d.amount)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground italic">
                                        Aún no hay abonos ni deducciones registradas.
                                      </p>
                                    )}
                                    {/* Summary row */}
                                    {hasDetails && (
                                      <>
                                        <div className="flex items-center justify-between pt-3 border-t border-border">
                                          <span className="text-sm font-semibold text-muted-foreground">Total deducido de la deuda</span>
                                          <span className="text-base font-bold text-success">
                                            −{formatCurrency((inv.details || []).reduce((s, d) => s + d.amount, 0))}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-sm font-semibold text-muted-foreground">Saldo pendiente</span>
                                          <span className="text-base font-bold text-destructive">
                                            {formatCurrency(inv.pending)}
                                          </span>
                                        </div>
                                      </>
                                    )}
                                    {/* Vincular pago CTA */}
                                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                                      <p className="text-xs text-muted-foreground">
                                        ¿Ya recibiste un pago bancario? Vinculalo a esta factura.
                                      </p>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="shrink-0 gap-1 text-xs border-primary/40 text-primary hover:bg-primary/10"
                                        onClick={(e) => { e.stopPropagation(); setVincularInvoice(inv); }}
                                      >
                                        <Link2 className="h-3.5 w-3.5" />
                                        Vincular pago
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Paid invoices */}
        {!isLoading && paidInvoices.length > 0 && (
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowPaid(!showPaid)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <CardTitle className="text-sm font-medium">
                    Facturas pagadas ({paidInvoices.length})
                  </CardTitle>
                </div>
                {showPaid
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
              </div>
            </CardHeader>
            {showPaid && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/80">
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="font-semibold"># Factura</TableHead>
                        <TableHead className="font-semibold">Cliente</TableHead>
                        <TableHead className="font-semibold">Emisión</TableHead>
                        <TableHead className="font-semibold text-right">Total</TableHead>
                        <TableHead className="font-semibold text-right">Abonado</TableHead>
                        <TableHead className="font-semibold text-right">Pendiente</TableHead>
                        <TableHead className="font-semibold text-center">Días</TableHead>
                        <TableHead className="font-semibold text-center">Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paidInvoices.map((inv) => {
                        const isExpanded = expandedRows.has(inv.id);
                        const hasDetails = (inv.details?.length ?? 0) > 0;
                        return (
                          <React.Fragment key={inv.id}>
                            <TableRow
                              className={cn(
                                hasDetails && 'cursor-pointer hover:bg-muted/50',
                                isExpanded && 'bg-muted/30 border-l-2 border-l-primary'
                              )}
                              onClick={() => hasDetails && toggleRow(inv.id)}
                            >
                              <TableCell className="w-8 px-2">
                                {hasDetails && (
                                  isExpanded
                                    ? <ChevronDown className="h-4 w-4 text-primary" />
                                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </TableCell>
                              <TableCell className="text-sm font-medium">{inv.invoice_number}</TableCell>
                              <TableCell className="text-sm">{inv.counterparty_name || 'Sin nombre'}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">
                                {format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es })}
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium">
                                {formatCurrency(inv.total_amount)}
                              </TableCell>
                              <TableCell className="text-right text-sm text-success">
                                {formatCurrency(inv.paid_amount)}
                              </TableCell>
                              <TableCell className="text-right text-sm text-muted-foreground">
                                {formatCurrency(inv.pending)}
                              </TableCell>
                              <TableCell className="text-center text-sm text-muted-foreground">
                                {inv.days_since}d
                              </TableCell>
                              <TableCell className="text-center">{statusBadge(inv.status)}</TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`${inv.id}-details`} className="hover:bg-transparent">
                                <TableCell colSpan={9} className="p-0">
                                  <div className="bg-muted/10 border-l-2 border-l-primary mx-0">
                                    <div className="px-6 py-4 space-y-3">
                                      <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                                        <Receipt className="h-4 w-4 text-primary" />
                                        Detalle de abonos y deducciones
                                      </p>
                                      <div className="space-y-2">
                                        {(inv.details || []).map((d, idx) => (
                                          <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/60">
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/60 shrink-0">
                                              {detailIcon(d.type)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 mb-0.5">
                                                {detailTypeBadge(d.type)}
                                                {d.date && (
                                                  <span className="text-xs text-muted-foreground">
                                                    {format(parseLocalDate(d.date), 'dd MMM yyyy', { locale: es })}
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-sm text-foreground truncate">{d.label}</p>
                                            </div>
                                            <span className={cn(
                                              "text-sm font-bold whitespace-nowrap",
                                              d.type === 'retefuente' ? 'text-primary' : 'text-success'
                                            )}>
                                              −{formatCurrency(d.amount)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="flex items-center justify-between pt-3 border-t border-border">
                                        <span className="text-sm font-semibold text-muted-foreground">Total deducido</span>
                                        <span className="text-base font-bold text-success">
                                          −{formatCurrency((inv.details || []).reduce((s, d) => s + d.amount, 0))}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        <VincularPagoModal
          open={!!vincularInvoice}
          onOpenChange={(v) => { if (!v) setVincularInvoice(null); }}
          invoice={vincularInvoice ? {
            id: vincularInvoice.id,
            invoice_number: vincularInvoice.invoice_number,
            counterparty_name: vincularInvoice.counterparty_name,
            pending: vincularInvoice.pending,
            total_amount: vincularInvoice.total_amount,
          } : null}
          onSuccess={() => { refetch(); }}
        />

        <VincularPagoModal
          open={!!vincularSaldoInicial}
          onOpenChange={(v) => { if (!v) setVincularSaldoInicial(null); }}
          saldoInicial={vincularSaldoInicial}
          onSuccess={() => { refetch(); }}
        />
      </div>
    </TooltipProvider>
  );
}
