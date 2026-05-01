// Modal para vincular UNA transacción bancaria a UNA factura.
//
// Es el flujo inverso al VincularPagoModal existente: ahí partís de una
// factura y buscás la transacción que la pagó. Acá partís de la transacción
// (un pago en banco) y buscás qué factura la cubre. Útil cuando estás
// revisando la Relación de Pagos y ves un movimiento sin vincular.
//
// Comportamiento:
//   - Carga facturas pendientes (status='confirmed') del tipo correspondiente
//     (venta si la tx es ingreso, compra si es egreso).
//   - Prioriza las del mismo cliente (matchea por responsible_id si la
//     transacción ya tiene responsible asignado).
//   - Permite buscar por número de factura o nombre de cliente.
//   - Al confirmar: UPDATE transactions SET invoice_id = X.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Link2, Search, Calendar, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { suggestPaymentSplit, summarizeCredit, type AmortizationType } from '@/lib/amortization';

interface InvoiceCandidate {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  type: 'venta' | 'compra';
  responsible_id: string | null;
}

interface TxToLink {
  id: string;          // transaction id
  date: string;
  description: string;
  amount: number;      // absoluto
  type: 'ingreso' | 'egreso';
  counterparty: string | null;
  responsibleId: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tx: TxToLink | null;
  onSuccess?: () => void;
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface CreditCandidate {
  id: string;
  name: string;
  bank_name: string | null;
  principal: number;
  interest_rate_monthly: number;
  term_months: number;
  first_payment_date: string;
  amortization_type: AmortizationType;
  default_category_id: string | null;
  default_responsible_id: string | null;
  // Computed
  currentBalance: number;
  nextCuotaAmount: number | null;
  nextCuotaDate: string | null;
}

export default function VincularFacturaTxModal({ open, onOpenChange, tx, onSuccess }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'factura' | 'credito'>('factura');
  const [invoices, setInvoices] = useState<InvoiceCandidate[]>([]);
  const [credits, setCredits] = useState<CreditCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);

  // Reset al abrir/cerrar
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedInvoiceId(null);
      setSelectedCreditId(null);
      // Si la tx es egreso, abrimos primero la pestaña de crédito (caso típico
      // de pago de cuota mensual). Si es ingreso, factura.
      setTab(tx?.type === 'egreso' ? 'credito' : 'factura');
    }
  }, [open, tx?.type]);

  // Cargar facturas candidatas
  useEffect(() => {
    if (!open || !user || !tx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const targetType = tx.type === 'ingreso' ? 'venta' : 'compra';
        // Solo facturas del último 1.5 años para no traer histórico viejo
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 18);
        const cutoff = cutoffDate.toISOString().slice(0, 10);

        const { data } = await supabase
          .from('invoices')
          .select('id, invoice_number, counterparty_name, issue_date, due_date, total_amount, type, responsible_id')
          .eq('user_id', user.id)
          .eq('type', targetType)
          .eq('status', 'confirmed')
          .gte('issue_date', cutoff)
          .order('issue_date', { ascending: false })
          .limit(200);
        if (!cancelled) {
          setInvoices((data ?? []) as any);
        }
      } catch (err) {
        console.error('Error loading invoices:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, user, tx]);

  // Cargar créditos activos (sólo si la tx es egreso — los créditos se pagan)
  useEffect(() => {
    if (!open || !user || !tx || tx.type !== 'egreso') return;
    let cancelled = false;
    (async () => {
      setLoadingCredits(true);
      try {
        const [credRes, paymentsRes] = await Promise.all([
          (supabase.from('credits' as never) as any)
            .select('id, name, bank_name, principal, interest_rate_monthly, term_months, first_payment_date, amortization_type, default_category_id, default_responsible_id')
            .eq('user_id', user.id)
            .eq('status', 'active'),
          (supabase.from('credit_payments' as never) as any)
            .select('credit_id, payment_date, amount_paid, principal_paid, interest_paid, is_extra')
            .eq('user_id', user.id),
        ]);

        if (cancelled) return;

        const allCreds = (credRes.data ?? []) as Array<CreditCandidate & {
          principal: number; interest_rate_monthly: number;
        }>;
        const allPays = (paymentsRes.data ?? []) as Array<{
          credit_id: string; payment_date: string; amount_paid: number;
          principal_paid: number; interest_paid: number; is_extra: boolean;
        }>;

        const enriched: CreditCandidate[] = allCreds.map((c) => {
          const myPays = allPays.filter((p) => p.credit_id === c.id);
          const summary = summarizeCredit(
            {
              principal: Number(c.principal),
              interestRateMonthlyPct: Number(c.interest_rate_monthly),
              termMonths: c.term_months,
              firstPaymentDate: c.first_payment_date,
              type: c.amortization_type,
            },
            myPays,
            0,
          );
          return {
            ...c,
            currentBalance: summary.currentBalance,
            nextCuotaAmount: summary.nextCuota?.cuotaTotal ?? null,
            nextCuotaDate: summary.nextCuota?.fecha ?? null,
          };
        });

        setCredits(enriched);
      } catch (err) {
        console.error('Error loading credits:', err);
      } finally {
        if (!cancelled) setLoadingCredits(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, user, tx]);

  // Filtrar y ordenar: facturas del mismo cliente arriba, después por fecha
  const filteredInvoices = useMemo(() => {
    if (!tx) return [];
    const q = search.trim().toLowerCase();
    let list = invoices;
    if (q) {
      list = list.filter(i =>
        (i.invoice_number ?? '').toLowerCase().includes(q) ||
        (i.counterparty_name ?? '').toLowerCase().includes(q),
      );
    }
    // Heurística: facturas del mismo cliente primero
    return [...list].sort((a, b) => {
      const aMatchesResp = tx.responsibleId && a.responsible_id === tx.responsibleId;
      const bMatchesResp = tx.responsibleId && b.responsible_id === tx.responsibleId;
      if (aMatchesResp && !bMatchesResp) return -1;
      if (!aMatchesResp && bMatchesResp) return 1;
      // Si counterparty matchea por nombre
      const txCounter = (tx.counterparty ?? '').toLowerCase();
      const aMatchesName = txCounter && (a.counterparty_name ?? '').toLowerCase().includes(txCounter);
      const bMatchesName = txCounter && (b.counterparty_name ?? '').toLowerCase().includes(txCounter);
      if (aMatchesName && !bMatchesName) return -1;
      if (!aMatchesName && bMatchesName) return 1;
      // Por fecha desc
      return b.issue_date.localeCompare(a.issue_date);
    });
  }, [invoices, search, tx]);

  // Heurística para destacar facturas con monto similar al de la transacción
  const txAmount = tx?.amount ?? 0;
  const isAmountSimilar = (invAmount: number) => {
    if (!txAmount) return false;
    const diff = Math.abs(invAmount - txAmount) / txAmount;
    return diff <= 0.05; // 5% tolerancia
  };

  const handleSave = async () => {
    if (!tx || !user) return;
    if (tab === 'factura') {
      if (!selectedInvoiceId) return;
      setSaving(true);
      try {
        const { error } = await supabase
          .from('transactions')
          .update({ invoice_id: selectedInvoiceId })
          .eq('id', tx.id)
          .eq('user_id', user.id);
        if (error) throw error;
        const inv = invoices.find(i => i.id === selectedInvoiceId);
        toast.success(`Vinculado a factura #${inv?.invoice_number ?? ''}`);
        onSuccess?.();
        onOpenChange(false);
      } catch (err: any) {
        console.error('Error linking:', err);
        toast.error(err?.message || 'No pudimos vincular. Probá de nuevo.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // tab === 'credito': crear credit_payment + actualizar tx (categoría + responsable)
    if (!selectedCreditId) return;
    const credit = credits.find((c) => c.id === selectedCreditId);
    if (!credit) return;
    setSaving(true);
    try {
      // Sugerir split capital/interés con tasa actual y saldo
      const split = suggestPaymentSplit(
        credit.currentBalance,
        Number(credit.interest_rate_monthly),
        tx.amount,
        false,
      );

      const { data: cpData, error: cpErr } = await (supabase.from('credit_payments' as never) as any)
        .insert({
          user_id: user.id,
          credit_id: credit.id,
          payment_date: tx.date,
          amount_paid: tx.amount,
          principal_paid: split.principal,
          interest_paid: split.interest,
          is_extra: false,
          notes: `Conciliado desde extracto: ${tx.description}`,
          transaction_id: tx.id,
        })
        .select()
        .single();
      if (cpErr) throw cpErr;

      // Actualizar la tx con categoría y beneficiario por defecto del crédito
      const txUpdate: Record<string, unknown> = {};
      if (credit.default_category_id) txUpdate.category_id = credit.default_category_id;
      if (credit.default_responsible_id) txUpdate.responsible_id = credit.default_responsible_id;
      if (Object.keys(txUpdate).length > 0) {
        const { error: txErr } = await supabase
          .from('transactions')
          .update(txUpdate)
          .eq('id', tx.id)
          .eq('user_id', user.id);
        if (txErr) throw txErr;
      }

      // Si el saldo después del pago llega a ~0, marcar crédito como pagado
      const newBalance = credit.currentBalance - split.principal;
      if (newBalance <= 0.5) {
        await (supabase.from('credits' as never) as any)
          .update({ status: 'paid' })
          .eq('id', credit.id);
        toast.success(`Crédito ${credit.name} saldado 🎉`);
      } else {
        toast.success(`Pago vinculado a "${credit.name}" — saldo: ${formatCOP(newBalance)}`);
      }

      onSuccess?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error linking credit:', err);
      toast.error(err?.message || 'No pudimos vincular el pago al crédito.');
    } finally {
      setSaving(false);
    }
  };

  if (!tx) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Conciliar transacción</DialogTitle>
          <DialogDescription>
            Vinculá este {tx.type === 'ingreso' ? 'cobro' : 'pago'} con una factura o un crédito.
          </DialogDescription>
        </DialogHeader>

        {/* Resumen de la transacción */}
        <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium truncate">{tx.description}</p>
            <p className={`text-sm font-bold tabular-nums ${tx.type === 'ingreso' ? 'text-success' : 'text-destructive'}`}>
              {tx.type === 'ingreso' ? '+' : '−'}{formatCOP(tx.amount)}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{formatDate(tx.date)}</span>
            {tx.counterparty && <span>Beneficiario: {tx.counterparty}</span>}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'factura' | 'credito')} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="factura" className="gap-1.5"><Calendar className="h-3.5 w-3.5" />Factura</TabsTrigger>
            <TabsTrigger value="credito" className="gap-1.5" disabled={tx.type !== 'egreso'}>
              <CreditCard className="h-3.5 w-3.5" />Crédito
              {tx.type !== 'egreso' && <span className="text-[9px] text-muted-foreground">(solo egresos)</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="factura" className="flex-1 flex flex-col gap-3 mt-3 min-h-0 data-[state=inactive]:hidden">
            {/* Buscador */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por número de factura o cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Lista de facturas */}
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {loading ? (
                <div className="py-8 flex items-center justify-center text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Cargando facturas…</span>
                </div>
              ) : filteredInvoices.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No hay facturas {tx.type === 'ingreso' ? 'de venta' : 'de compra'} confirmadas que coincidan.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredInvoices.map((inv) => {
                    const isSelected = inv.id === selectedInvoiceId;
                    const matchesAmount = isAmountSimilar(Number(inv.total_amount));
                    const matchesResp = tx.responsibleId && inv.responsible_id === tx.responsibleId;
                    return (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => setSelectedInvoiceId(inv.id)}
                        className={cn(
                          "w-full text-left rounded-md border p-3 transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">#{inv.invoice_number}</span>
                              {matchesResp && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success font-semibold">
                                  Mismo cliente
                                </span>
                              )}
                              {matchesAmount && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold">
                                  Monto coincide
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {inv.counterparty_name ?? 'Sin contraparte'}
                            </p>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(inv.issue_date)}
                              </span>
                              {inv.due_date && (
                                <span>Vence: {formatDate(inv.due_date)}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold tabular-nums">{formatCOP(Number(inv.total_amount))}</p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                              Total
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="credito" className="flex-1 flex flex-col gap-3 mt-3 min-h-0 data-[state=inactive]:hidden">
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {loadingCredits ? (
                <div className="py-8 flex items-center justify-center text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Cargando créditos…</span>
                </div>
              ) : credits.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tenés créditos activos. Creá uno desde Créditos para vincular pagos.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {credits.map((c) => {
                    const isSelected = c.id === selectedCreditId;
                    const matchesCuota = c.nextCuotaAmount
                      ? Math.abs(c.nextCuotaAmount - tx.amount) / c.nextCuotaAmount <= 0.15
                      : false;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCreditId(c.id)}
                        className={cn(
                          "w-full text-left rounded-md border p-3 transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{c.name}</span>
                              {matchesCuota && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold">
                                  Cuota coincide
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {c.bank_name ?? 'Sin banco'} · {Number(c.interest_rate_monthly).toFixed(2)}%/mes · {c.term_months}m
                            </p>
                            {c.nextCuotaAmount !== null && c.nextCuotaDate && (
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Próxima cuota: {formatCOP(c.nextCuotaAmount)} · {formatDate(c.nextCuotaDate)}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold tabular-nums">{formatCOP(c.currentBalance)}</p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                              Saldo
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedCreditId && (() => {
              const credit = credits.find((c) => c.id === selectedCreditId);
              if (!credit) return null;
              const split = suggestPaymentSplit(
                credit.currentBalance,
                Number(credit.interest_rate_monthly),
                tx.amount,
                false,
              );
              return (
                <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-0.5">
                  <p className="font-medium text-foreground">Al confirmar:</p>
                  <p>• Capital: <span className="font-semibold">{formatCOP(split.principal)}</span></p>
                  <p>• Interés: <span className="font-semibold text-amber-700">{formatCOP(split.interest)}</span></p>
                  {credit.default_category_id && <p>• Categoría se setea por defecto del crédito</p>}
                  {credit.default_responsible_id && <p>• Beneficiario se setea por defecto del crédito</p>}
                  <p className="text-muted-foreground italic pt-0.5">Podés ajustar el split después desde el detalle del crédito.</p>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || (tab === 'factura' ? !selectedInvoiceId : !selectedCreditId)}
            className="gap-2"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Vinculando…</> : <><Link2 className="h-4 w-4" /> Vincular</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
