import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Banknote, History, Info, Link2, Check, X, ChevronRight, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MONTH_NAMES } from '@/types/transaction';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import AdvancesTable from './AdvancesTable';

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

export default function AdvancesReport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(currentYear);
  const [reconcilingDetail, setReconcilingDetail] = useState<string | null>(null);

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { data, isLoading } = useQuery({
    queryKey: ['advances-report', user?.id, year],
    queryFn: async () => {
      if (!user) return null;

      // Fetch transactions + initial state details in parallel
      const [txResult, initialDetailsResult, initialStateResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, date, description, amount, owner, responsible_id, notes, statement_id, category, category_id, invoice_id, categories!transactions_category_id_fkey(name)')
          .eq('type', 'ingreso')
          .is('deleted_at', null)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false }),
        supabase
          .from('initial_state_details' as any)
          .select('*')
          .eq('field_type', 'anticipos_de_clientes'),
        supabase
          .from('initial_financial_state' as any)
          .select('anticipos_de_clientes, fecha_inicio')
          .maybeSingle(),
      ]);

      if (txResult.error) throw txResult.error;
      if (initialDetailsResult.error) throw initialDetailsResult.error;
      if (initialStateResult.error) throw initialStateResult.error;
      const transactions = txResult.data || [];
      const initialDetails = (initialDetailsResult.data as any[]) || [];
      const initialState = initialStateResult.data as any;

      // Get responsible names
      const allRespIds = [...new Set(transactions.filter(t => t.responsible_id).map(t => t.responsible_id!))];
      let respMap = new Map<string, string>();
      if (allRespIds.length > 0) {
        const { data: resps } = await supabase
          .from('responsibles')
          .select('id, name')
          .in('id', allRespIds);
        if (resps) resps.forEach(r => respMap.set(r.id, r.name));
      }

      // Filter: Ingreso + Category "Ventas" + Responsible != "Otros" + no invoice
      const filtered = transactions.filter((t: any) => {
        const catName = (t.categories?.name || t.category || '').trim().toLowerCase();
        const hasResponsible = Boolean(t.responsible_id);
        const isVentas = catName === 'ventas';
        const respName = t.responsible_id ? respMap.get(t.responsible_id) : null;
        const isRespOtros = respName?.toLowerCase() === 'otros';
        const hasNoInvoice = !t.invoice_id;
        return hasResponsible && isVentas && !isRespOtros && hasNoInvoice;
      });

      // Get statement names (weekly statements have null month/year — fallback to date range)
      const statementIds = [...new Set(filtered.map(t => t.statement_id))];
      let statementsMap = new Map<string, string>();
      if (statementIds.length > 0) {
        const { data: statements } = await supabase
          .from('bank_statements')
          .select('id, display_name, bank_name, period_start, period_end, statement_month, statement_year')
          .in('id', statementIds);
        if (statements) {
          statements.forEach((s: any) => {
            let label = s.display_name || s.bank_name;
            if (!s.display_name && s.statement_month == null && s.statement_year == null && s.period_start && s.period_end) {
              const fmt = (iso: string) => {
                const [, m, d] = iso.split('-');
                return `${d}/${m}`;
              };
              label = `Movimientos semana ${fmt(s.period_start)}-${fmt(s.period_end)}`;
            }
            statementsMap.set(s.id, label);
          });
        }
      }

      // Get user invoices for reconciliation
      // Excluir facturas anuladas totalmente por NC: no se les puede vincular
      // anticipos porque ya no son facturación válida.
      const { data: invoicesRaw } = await supabase
        .from('invoices')
        // ⚠️ NO pedir `retefuente_amount` — esa columna vive en transactions, no
        // en invoices; pedirla rompe el query en silencio. Sí existen los
        // retefuente_cliente_*. Mismos campos que clientReceivables.ts (cobranza).
        .select('id, invoice_number, counterparty_name, total_amount, issue_date, subtotal_base, retefuente_cliente_amount, retefuente_cliente_rate, reteica_amount, autoretefuente_amount' as never)
        .eq('type', 'venta')
        .or('void_type.is.null,void_type.eq.partial')
        .order('issue_date', { ascending: false })
        .limit(200);

      // Calcular saldo pendiente por factura para mostrar en el dropdown.
      // El user no debe vincular anticipos a ciegas — necesita ver cuánto
      // falta cobrar de cada factura candidata.
      const invIds = (invoicesRaw ?? []).map((i: any) => i.id);
      const appliedById = new Map<string, number>();
      if (invIds.length > 0) {
        const [directRes, matchRes, advRes] = await Promise.all([
          supabase
            .from('transactions')
            .select('invoice_id, amount')
            .is('deleted_at', null)
            .in('invoice_id', invIds),
          supabase
            .from('invoice_transaction_matches')
            .select('invoice_id, matched_amount')
            .in('invoice_id', invIds),
          supabase
            .from('initial_state_details' as any)
            .select('invoice_id, amount')
            .eq('field_type', 'anticipos_de_clientes')
            .in('invoice_id', invIds),
        ]);
        for (const t of ((directRes.data ?? []) as any[])) {
          if (!t.invoice_id) continue;
          appliedById.set(t.invoice_id, (appliedById.get(t.invoice_id) ?? 0) + Math.abs(Number(t.amount ?? 0)));
        }
        for (const m of ((matchRes.data ?? []) as any[])) {
          appliedById.set(m.invoice_id, (appliedById.get(m.invoice_id) ?? 0) + Math.abs(Number(m.matched_amount ?? 0)));
        }
        for (const a of ((advRes.data ?? []) as any[])) {
          if (!a.invoice_id) continue;
          appliedById.set(a.invoice_id, (appliedById.get(a.invoice_id) ?? 0) + Math.abs(Number(a.amount ?? 0)));
        }
      }
      // Retenciones de VENTA — MISMO criterio que clientReceivables.ts (fuente de
      // verdad de cobranza) e InvoiceSelector (conciliación): retefuente_cliente
      // (con fallback 2.5% para facturas legacy sin tasa) + reteica +
      // autoretefuente. Plata que el cliente retuvo y pagó a DIAN/municipio, no
      // vuelve al banco → no es saldo vivo. Idéntico para que anticipos cuadre.
      const ventaRetenciones = (inv: any): number => {
        const savedRete = Number(inv.retefuente_cliente_amount ?? 0);
        const rawRate = inv.retefuente_cliente_rate;
        const hasExplicitRate = rawRate !== null && rawRate !== undefined;
        const effectiveRate = hasExplicitRate ? Number(rawRate) : 0.025;
        const retefuente = savedRete > 0
          ? savedRete
          : Math.round(Number(inv.subtotal_base ?? 0) * effectiveRate);
        const reteica = Math.abs(Number(inv.reteica_amount ?? 0));
        const autoretefuente = Math.abs(Number(inv.autoretefuente_amount ?? 0));
        return retefuente + reteica + autoretefuente;
      };
      const invoicesWithPending = (invoicesRaw ?? []).map((i: any) => {
        const applied = appliedById.get(i.id) ?? 0;
        const retenciones = ventaRetenciones(i);
        const pending = Math.max(0, Number(i.total_amount ?? 0) - applied - retenciones);
        return { ...i, applied, retenciones, pending };
      });

      return {
        transactions: filtered,
        statementsMap,
        respMap,
        invoices: invoicesWithPending,
        initialDetails,
        initialAnticipo: initialState?.anticipos_de_clientes ?? 0,
        fechaInicio: initialState?.fecha_inicio,
      };
    },
    enabled: !!user,
  });

  const handleReconcileDetail = async (detailId: string, invoiceId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('initial_state_details' as any)
        .update({ invoice_id: invoiceId } as any)
        .eq('id', detailId);
      if (error) throw error;
      toast.success('Anticipo de periodo anterior vinculado a factura');
      queryClient.invalidateQueries({ queryKey: ['advances-report'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-receivable'] });
      setReconcilingDetail(null);
    } catch {
      toast.error('Error al vincular');
    }
  };

  const handleUnlinkDetail = async (detailId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('initial_state_details' as any)
        .update({ invoice_id: null } as any)
        .eq('id', detailId);
      if (error) throw error;
      toast.success('Anticipo desvinculado');
      queryClient.invalidateQueries({ queryKey: ['advances-report'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-receivable'] });
    } catch {
      toast.error('Error al desvincular');
    }
  };

  // Only count unreconciled initial details
  const unreconciledDetails = useMemo(() => {
    return (data?.initialDetails || []).filter((d: any) => !d.invoice_id);
  }, [data]);

  const totalAdvancesTx = useMemo(() => {
    if (!data?.transactions) return 0;
    return data.transactions.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  }, [data]);

  const initialAnticipo = useMemo(() => {
    return unreconciledDetails.reduce((s: number, d: any) => s + (d.amount ?? 0), 0);
  }, [unreconciledDetails]);
  const totalAdvances = totalAdvancesTx + initialAnticipo;

  // Group by client → { total, months: Map<monthIndex, amount>, initial: amount }
  const byClient = useMemo(() => {
    const map = new Map<string, { total: number; months: Map<number, number>; initial: number }>();

    const ensure = (name: string) => {
      if (!map.has(name)) map.set(name, { total: 0, months: new Map(), initial: 0 });
      return map.get(name)!;
    };

    if (data?.transactions) {
      for (const tx of data.transactions) {
        const clientName = tx.owner || (tx.responsible_id ? data.respMap.get(tx.responsible_id) : null) || 'Sin asignar';
        const amount = Math.abs(tx.amount ?? 0);
        const entry = ensure(clientName);
        entry.total += amount;
        const monthIdx = tx.date ? new Date(tx.date + 'T00:00:00').getMonth() : 0;
        entry.months.set(monthIdx, (entry.months.get(monthIdx) ?? 0) + amount);
      }
    }

    for (const d of unreconciledDetails) {
      const name = (d as any).responsible_name || 'Periodo anterior';
      const amount = (d as any).amount ?? 0;
      const entry = ensure(name);
      entry.total += amount;
      entry.initial += amount;
    }

    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [data, unreconciledDetails]);

  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const toggleClient = (name: string) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Reporte de Anticipos</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Ingresos bancarios sin factura asociada. Incluye saldos iniciales configurados en ajustes.</p>
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

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Anticipos</CardTitle>
              <div className="p-2 rounded-lg bg-warning/10">
                <Banknote className="h-4 w-4 text-warning" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{formatCurrency(totalAdvances)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data?.transactions.length ?? 0} transacción{(data?.transactions.length ?? 0) !== 1 ? 'es' : ''} • {year}
                {initialAnticipo > 0 && ` + saldo inicial`}
              </p>
            </CardContent>
          </Card>

          {/* Previous period (initial state) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Anticipos Periodo Anterior</CardTitle>
              <div className="p-2 rounded-lg bg-muted">
                <History className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(initialAnticipo)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data?.fechaInicio
                  ? <><span className="font-bold">Corte: {data.fechaInicio}</span></>
                  : 'Sin estado inicial configurado'}
              </p>
              {data?.initialDetails && data.initialDetails.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t pt-2">
                  {data.initialDetails.map((d: any) => {
                    const isReconciled = !!d.invoice_id;
                    const invoice = isReconciled ? data.invoices.find((inv: any) => inv.id === d.invoice_id) : null;

                    return (
                      <div key={d.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate mr-2 text-muted-foreground">{d.responsible_name || 'Sin nombre'}</span>
                          <span className="font-semibold whitespace-nowrap">{formatCurrency(d.amount ?? 0)}</span>
                        </div>
                        {isReconciled ? (
                          <div className="flex items-center gap-1 text-xs text-success">
                            <Check className="h-3 w-3" />
                            <span className="flex-1">Vinculada: {invoice?.invoice_number || 'Factura'}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => handleUnlinkDetail(d.id)}
                              title="Desvincular"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : reconcilingDetail === d.id ? (
                          <Select onValueChange={(invoiceId) => handleReconcileDetail(d.id, invoiceId)}>
                            <SelectTrigger className="h-6 text-xs">
                              <SelectValue placeholder="Seleccionar factura" />
                            </SelectTrigger>
                            <SelectContent>
                              {/* Mostrar SALDO PENDIENTE como dato principal —
                                  el user pidió no vincular a ciegas. Total y
                                  ya aplicado quedan como info auxiliar. */}
                              {(data?.invoices || []).map((inv: any) => {
                                const pending = Number(inv.pending ?? inv.total_amount ?? 0);
                                const total = Number(inv.total_amount ?? 0);
                                const isPaid = pending <= 0;
                                return (
                                  <SelectItem key={inv.id} value={inv.id} disabled={isPaid}>
                                    <span className="text-xs flex flex-col gap-0.5">
                                      <span className="font-medium">
                                        {inv.invoice_number} — {inv.counterparty_name || 'Sin nombre'}
                                      </span>
                                      <span className={isPaid ? 'text-success' : 'text-destructive'}>
                                        {isPaid ? 'Sin saldo (ya pagada)' : `Saldo: ${formatCurrency(pending)}`}
                                        {!isPaid && total !== pending && (
                                          <span className="text-muted-foreground"> · de {formatCurrency(total)}</span>
                                        )}
                                      </span>
                                    </span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-xs gap-1 px-1 text-muted-foreground hover:text-primary"
                            onClick={() => setReconcilingDetail(d.id)}
                          >
                            <Link2 className="h-3 w-3" />
                            Vincular factura
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* By client summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Anticipos por Cliente</CardTitle>
            </CardHeader>
            <CardContent>
              {byClient.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {byClient.map(([name, info]) => {
                    const isOpen = expandedClients.has(name);
                    const sortedMonths = [...info.months.entries()].sort((a, b) => a[0] - b[0]);
                    return (
                      <Collapsible key={name} open={isOpen} onOpenChange={() => toggleClient(name)}>
                        <CollapsibleTrigger className="flex items-center justify-between w-full text-sm py-1 hover:bg-muted/50 rounded px-1 transition-colors">
                          <span className="flex items-center gap-1 truncate mr-2">
                            {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{name}</span>
                          </span>
                          <span className="font-semibold text-warning whitespace-nowrap">{formatCurrency(info.total)}</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-5 py-1 space-y-0.5 border-l border-border ml-2">
                            {info.initial > 0 && (
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Saldo inicial</span>
                                <span className="font-medium">{formatCurrency(info.initial)}</span>
                              </div>
                            )}
                            {sortedMonths.map(([monthIdx, amount]) => (
                              <div key={monthIdx} className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{MONTH_NAMES[monthIdx]} {year}</span>
                                <span className="font-medium">{formatCurrency(amount)}</span>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <AdvancesTable
          transactions={data?.transactions ?? []}
          statementsMap={data?.statementsMap ?? new Map()}
          respMap={data?.respMap ?? new Map()}
          invoices={data?.invoices ?? []}
          isLoading={isLoading}
          showReconcile={true}
        />
      </div>
    </TooltipProvider>
  );
}
