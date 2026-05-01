import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FileText, Search, X, ShieldCheck, Receipt, Plus, Wallet, CreditCard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { suggestPaymentSplit, summarizeCredit, type AmortizationType } from '@/lib/amortization';

interface InvoiceOption {
  id: string;
  invoice_number: string;
  type: string;
  counterparty_name: string | null;
  issue_date: string;
  total_amount: number;
  outstanding: number; // saldo por cobrar
}

export type InvoiceTag = 'na' | 'iva_favor' | 'retefuente' | 'anticipo';

export interface CreditLinkInfo {
  creditId: string;
  creditName: string;
  paymentDate: string;
  amountPaid: number;
  principalPaid: number;
  interestPaid: number;
  newBalance: number;
  defaultCategoryId: string | null;
  defaultResponsibleId: string | null;
}

interface InvoiceSelectorProps {
  invoiceId: string | null;
  tags: InvoiceTag[];
  transactionType: string;
  transactionAmount?: number | null;
  transactionDate?: string;
  transactionId?: string;
  onChange: (invoiceId: string | null, tags: InvoiceTag[], autoMatches?: AutoMatchResult[], creditLink?: CreditLinkInfo) => void;
  className?: string;
}

export interface AutoMatchResult {
  invoiceId: string;
  invoiceNumber: string;
  matchedAmount: number;
}

interface CreditOption {
  id: string;
  name: string;
  bank_name: string | null;
  interest_rate_monthly: number;
  default_category_id: string | null;
  default_responsible_id: string | null;
  currentBalance: number;
  nextCuotaAmount: number | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const TAG_CONFIG: Record<InvoiceTag, { label: string; icon: typeof FileText; colorClass: string; description: string }> = {
  na: { label: 'N/A', icon: FileText, colorClass: 'text-muted-foreground', description: 'Sin factura asociada' },
  iva_favor: { label: 'IVA a favor', icon: ShieldCheck, colorClass: 'text-success', description: 'Pago impuesto DIAN' },
  retefuente: { label: 'Retefuente', icon: Receipt, colorClass: 'text-primary', description: 'Sin factura, con retención' },
  anticipo: { label: 'Anticipo', icon: Wallet, colorClass: 'text-warning', description: 'Pago anticipado sin factura' },
};

export default function InvoiceSelector({ invoiceId, tags, transactionType, transactionAmount, transactionDate, transactionId, onChange, className }: InvoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [credits, setCredits] = useState<CreditOption[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();

  const invoiceTypeFilter = transactionType === 'ingreso' ? 'venta' : transactionType === 'egreso' ? 'compra' : null;

  const fetchInvoicesWithBalances = useCallback(async () => {
    // Fetch confirmed invoices
    const { data: rawInvoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, type, counterparty_name, issue_date, total_amount')
      .eq('status', 'confirmed')
      .order('issue_date', { ascending: false })
      .limit(200);

    if (!rawInvoices?.length) {
      setInvoices([]);
      setLoaded(true);
      return;
    }

    const invoiceIds = rawInvoices.map(i => i.id);

    // Fetch direct transaction payments (exclude current transaction)
    const directQuery = supabase
      .from('transactions')
      .select('invoice_id, amount')
      .is('deleted_at', null)
      .in('invoice_id', invoiceIds);
    
    // Fetch match payments
    const matchQuery = supabase
      .from('invoice_transaction_matches')
      .select('invoice_id, matched_amount')
      .in('invoice_id', invoiceIds);

    const [{ data: directPayments }, { data: matchPayments }] = await Promise.all([directQuery, matchQuery]);

    // Aggregate payments per invoice
    const paidByInvoice = new Map<string, number>();
    (directPayments || []).forEach(p => {
      if (p.invoice_id) {
        // Exclude current transaction from calculation to avoid double-counting
        const current = paidByInvoice.get(p.invoice_id) || 0;
        paidByInvoice.set(p.invoice_id, current + Math.abs(p.amount ?? 0));
      }
    });
    (matchPayments || []).forEach(p => {
      const current = paidByInvoice.get(p.invoice_id) || 0;
      paidByInvoice.set(p.invoice_id, current + Math.abs(p.matched_amount));
    });

    // If current transaction is already linked to an invoice, subtract it from paid
    // to show the balance as if this transaction weren't yet applied
    if (transactionId && transactionAmount != null) {
      // Find if this transaction is in directPayments
      const currentTxPayments = (directPayments || []).filter(p => p.invoice_id && invoiceIds.includes(p.invoice_id));
      // We can't filter by transaction_id from the query (we only have invoice_id, amount)
      // Instead, if invoiceId is set, subtract this transaction's amount from that invoice's paid total
      if (invoiceId) {
        const currentPaid = paidByInvoice.get(invoiceId) || 0;
        paidByInvoice.set(invoiceId, Math.max(0, currentPaid - Math.abs(transactionAmount)));
      }
    }

    const enriched: InvoiceOption[] = rawInvoices.map(inv => {
      const paid = paidByInvoice.get(inv.id) || 0;
      const outstanding = Math.max(0, inv.total_amount - paid);
      return { ...inv, outstanding };
    });

    setInvoices(enriched);

    // Cargar créditos activos sólo para egresos
    if (transactionType === 'egreso') {
      const [credRes, paysRes] = await Promise.all([
        (supabase.from('credits' as never) as any)
          .select('id, name, bank_name, principal, interest_rate_monthly, term_months, first_payment_date, amortization_type, default_category_id, default_responsible_id')
          .eq('status', 'active'),
        (supabase.from('credit_payments' as never) as any)
          .select('credit_id, payment_date, amount_paid, principal_paid, interest_paid, is_extra'),
      ]);

      const allCreds = (credRes.data ?? []) as Array<{
        id: string; name: string; bank_name: string | null;
        principal: number; interest_rate_monthly: number; term_months: number;
        first_payment_date: string; amortization_type: AmortizationType;
        default_category_id: string | null; default_responsible_id: string | null;
      }>;
      const allPays = (paysRes.data ?? []) as Array<{
        credit_id: string; payment_date: string; amount_paid: number;
        principal_paid: number; interest_paid: number; is_extra: boolean;
      }>;

      const enrichedCreds: CreditOption[] = allCreds.map((c) => {
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
          id: c.id,
          name: c.name,
          bank_name: c.bank_name,
          interest_rate_monthly: Number(c.interest_rate_monthly),
          default_category_id: c.default_category_id,
          default_responsible_id: c.default_responsible_id,
          currentBalance: summary.currentBalance,
          nextCuotaAmount: summary.nextCuota?.cuotaTotal ?? null,
        };
      });
      setCredits(enrichedCreds);
    } else {
      setCredits([]);
    }

    setLoaded(true);
  }, [transactionId, transactionAmount, invoiceId, transactionType]);

  useEffect(() => {
    if (!open || loaded) return;
    fetchInvoicesWithBalances();
  }, [open, loaded, fetchInvoicesWithBalances]);

  // Reset loaded when transaction changes to refresh balances
  useEffect(() => {
    setLoaded(false);
  }, [transactionId, invoiceId]);

  const filtered = useMemo(() => {
    let result = invoices;
    if (invoiceTypeFilter) {
      result = result.filter(inv => inv.type === invoiceTypeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(inv =>
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.counterparty_name || '').toLowerCase().includes(q) ||
        inv.issue_date.includes(q) ||
        formatCurrency(inv.outstanding).toLowerCase().includes(q)
      );
    }
    return result;
  }, [invoices, search, invoiceTypeFilter]);

  const selectedInvoice = invoices.find(inv => inv.id === invoiceId);

  const toggleTag = (tag: InvoiceTag) => {
    const newTags = tags.includes(tag)
      ? tags.filter(t => t !== tag)
      : [...tags, tag];
    
    if (tag === 'na' && !tags.includes('na') && invoiceId) {
      onChange(null, newTags);
    } else {
      onChange(invoiceId, newTags);
    }
    setOpen(false);
    setSearch('');
  };

  const removeTag = (tag: InvoiceTag) => {
    onChange(invoiceId, tags.filter(t => t !== tag));
  };

  const selectInvoice = (id: string) => {
    const newTags = tags.filter(t => t !== 'na');
    const selectedInv = invoices.find(inv => inv.id === id);
    
    if (!selectedInv || transactionAmount == null) {
      onChange(id, newTags);
      setOpen(false);
      setSearch('');
      return;
    }

    const paymentAmount = Math.abs(transactionAmount);
    const outstanding = selectedInv.outstanding;

    // Payment fits within outstanding balance - normal match
    if (paymentAmount <= outstanding) {
      onChange(id, newTags);
      setOpen(false);
      setSearch('');
      return;
    }

    // Payment exceeds outstanding - auto-distribute
    const excess = paymentAmount - outstanding;
    
    // Find another pending invoice from same counterparty with outstanding > 0
    const otherInvoices = invoices.filter(inv => 
      inv.id !== id &&
      inv.outstanding > 0 &&
      inv.type === selectedInv.type &&
      inv.counterparty_name &&
      selectedInv.counterparty_name &&
      inv.counterparty_name.toLowerCase() === selectedInv.counterparty_name.toLowerCase()
    );

    if (otherInvoices.length > 0) {
      // Apply excess to next invoice
      const nextInvoice = otherInvoices[0];
      const matchedToNext = Math.min(excess, nextInvoice.outstanding);
      const remainingExcess = excess - matchedToNext;
      
      const autoMatches: AutoMatchResult[] = [
        { invoiceId: nextInvoice.id, invoiceNumber: nextInvoice.invoice_number, matchedAmount: matchedToNext },
      ];

      // If there's still excess after second invoice, mark as anticipo
      const finalTags = remainingExcess > 0 
        ? [...newTags.filter(t => t !== 'anticipo'), 'anticipo' as InvoiceTag]
        : newTags.filter(t => t !== 'anticipo');

      toast({
        title: 'Abono distribuido',
        description: `${formatCurrency(outstanding)} aplicado a ${selectedInv.invoice_number}, ${formatCurrency(matchedToNext)} a ${nextInvoice.invoice_number}${remainingExcess > 0 ? `, ${formatCurrency(remainingExcess)} como anticipo` : ''}`,
      });

      onChange(id, finalTags, autoMatches);
    } else {
      // No other invoice - excess goes to anticipo
      const finalTags = [...newTags.filter(t => t !== 'anticipo'), 'anticipo' as InvoiceTag];
      
      toast({
        title: 'Anticipo registrado',
        description: `${formatCurrency(outstanding)} aplicado a ${selectedInv.invoice_number}, ${formatCurrency(excess)} registrado como anticipo`,
      });

      onChange(id, finalTags);
    }

    setOpen(false);
    setSearch('');
  };

  const clearInvoice = () => {
    onChange(null, tags.filter(t => t !== 'anticipo'));
  };

  const selectCredit = (credit: CreditOption) => {
    if (transactionAmount == null) return;
    const paymentDate = transactionDate ?? new Date().toISOString().slice(0, 10);
    const amountPaid = Math.abs(transactionAmount);
    const split = suggestPaymentSplit(
      credit.currentBalance,
      credit.interest_rate_monthly,
      amountPaid,
      false,
    );
    const newBalance = credit.currentBalance - split.principal;

    // Limpiar invoice si había, y notificar al padre con la info del crédito.
    // El padre se encarga del INSERT credit_payment + UPDATE category/responsible.
    const newTags = tags.filter(t => t !== 'na' && t !== 'anticipo');
    onChange(null, newTags, undefined, {
      creditId: credit.id,
      creditName: credit.name,
      paymentDate,
      amountPaid,
      principalPaid: split.principal,
      interestPaid: split.interest,
      newBalance,
      defaultCategoryId: credit.default_category_id,
      defaultResponsibleId: credit.default_responsible_id,
    });
    setOpen(false);
    setSearch('');
  };

  const hasAnySelection = !!invoiceId || tags.length > 0;

  const availableTags: InvoiceTag[] = transactionType === 'egreso'
    ? ['na', 'iva_favor', 'retefuente']
    : ['na'];

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {/* Selected invoice chip */}
      {selectedInvoice && (
        <span className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5 max-w-[120px]">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{selectedInvoice.invoice_number}</span>
          <button
            className="shrink-0 hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); clearInvoice(); }}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}

      {/* Tag chips */}
      {tags.map(tag => {
        const config = TAG_CONFIG[tag];
        const Icon = config.icon;
        return (
          <span
            key={tag}
            className={cn('inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5', config.colorClass)}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span>{config.label}</span>
            <button
              className="shrink-0 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {/* Add button / Pending label */}
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setLoaded(false); }}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 text-xs px-2',
              !hasAnySelection && 'text-warning font-medium',
              hasAnySelection && 'h-6 w-6 p-0'
            )}
          >
            {hasAnySelection ? (
              <Plus className="h-3 w-3" />
            ) : (
              'Pendiente'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por #, cliente, fecha..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {/* Special tag toggles */}
            {availableTags.map(tag => {
              const config = TAG_CONFIG[tag];
              const Icon = config.icon;
              const isActive = tags.includes(tag);
              return (
                <button
                  key={tag}
                  className={cn(
                    'w-full text-left px-3 py-2 text-xs hover:bg-muted/50 border-b border-border flex items-center gap-2',
                    isActive && 'bg-accent/10'
                  )}
                  onClick={() => toggleTag(tag)}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', config.colorClass)} />
                  <span className="text-foreground font-medium">{config.label} — {config.description}</span>
                  {isActive && <span className="ml-auto text-success">✓</span>}
                </button>
              );
            })}

            {/* Créditos vigentes (solo egresos) */}
            {transactionType === 'egreso' && credits.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
                  Créditos vigentes
                </div>
                {credits.map((c) => {
                  const matchesCuota = c.nextCuotaAmount && transactionAmount != null
                    ? Math.abs(c.nextCuotaAmount - Math.abs(transactionAmount)) / c.nextCuotaAmount <= 0.15
                    : false;
                  return (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center gap-2 border-b border-border/50"
                      onClick={() => selectCredit(c)}
                    >
                      <CreditCard className="h-3.5 w-3.5 shrink-0 text-cyan-700" />
                      <span className="font-medium shrink-0">{c.name}</span>
                      <span className="text-muted-foreground truncate flex-1">
                        {c.bank_name ?? 'Sin banco'} · saldo {formatCurrency(c.currentBalance)}
                      </span>
                      {matchesCuota && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold shrink-0">
                          Cuota
                        </span>
                      )}
                      {c.nextCuotaAmount && (
                        <span className="font-medium shrink-0 text-cyan-700">
                          {formatCurrency(c.nextCuotaAmount)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}

            {/* Separator */}
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
              Facturas confirmadas — Saldo por cobrar
            </div>

            {/* Invoice list */}
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {invoiceTypeFilter
                  ? `No hay facturas de ${invoiceTypeFilter} confirmadas`
                  : 'No hay facturas confirmadas'}
              </div>
            ) : (
              filtered.map(inv => {
                const prefix = inv.type === 'venta' ? 'FV' : 'FC';
                const isPaid = inv.outstanding <= 0;
                return (
                  <button
                    key={inv.id}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center gap-2 border-b border-border/50',
                      inv.id === invoiceId && 'bg-accent/10',
                      isPaid && 'opacity-50'
                    )}
                    onClick={() => selectInvoice(inv.id)}
                  >
                    <span className="font-medium shrink-0">
                      {prefix}-{inv.invoice_number}
                    </span>
                    <span className="text-muted-foreground truncate flex-1">
                      {inv.counterparty_name || 'Sin nombre'}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {inv.issue_date}
                    </span>
                    <span className={cn(
                      'font-medium shrink-0',
                      isPaid ? 'text-success' : 'text-foreground'
                    )}>
                      {isPaid ? 'Pagada' : formatCurrency(inv.outstanding)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
