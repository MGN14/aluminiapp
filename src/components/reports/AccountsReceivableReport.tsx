import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MONTH_NAMES } from '@/types/transaction';
import { Receipt, AlertCircle, Info, Lightbulb, CheckCircle2, ChevronDown, ChevronRight, Banknote, ShieldCheck, History } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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

export default function AccountsReceivableReport() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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

      const { data: invoices, error: invErr } = await supabase
        .from('invoices')
        .select('id, invoice_number, counterparty_name, issue_date, total_amount, subtotal_base, status, type, retefuente_cliente_amount, retefuente_cliente_rate, autoretefuente_amount, reteica_amount')
        .eq('user_id', user.id)
        .eq('type', 'venta')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate)
        .order('issue_date', { ascending: false });

      if (invErr) throw invErr;
      if (!invoices?.length) return { receivables: [], suggestions: [] };

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
        const paid = paymentsByInvoice.get(inv.id) || 0;
        // Use saved amount, or calculate 2.5% of subtotal_base as fallback
        const savedRetefuente = (inv as any).retefuente_cliente_amount ?? 0;
        const rawRate = (inv as any).retefuente_cliente_rate ?? 0;
        const effectiveRate = rawRate > 0 && rawRate < 1 ? rawRate : 0.025;
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

      return { receivables: unpaid, suggestions, allReceivables: receivables };
    },
    enabled: !!user,
  });

  const totalPending = useMemo(() => {
    return (data?.receivables || []).reduce((s, r) => s + r.pending, 0);
  }, [data]);

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
                <CardTitle className="text-lg">Cuentas por Cobrar</CardTitle>
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

        {/* KPI */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Cuentas por Cobrar</CardTitle>
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
                  ) : !data?.receivables?.length ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">No hay facturas con saldo pendiente en {year}.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.receivables.map((inv) => {
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
                                                  {format(new Date(d.date), 'dd MMM yyyy', { locale: es })}
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
                                    {/* Summary row */}
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
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
