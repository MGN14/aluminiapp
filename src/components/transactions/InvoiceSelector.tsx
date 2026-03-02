import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FileText, Search, X, ShieldCheck, Receipt, Plus } from 'lucide-react';

interface InvoiceOption {
  id: string;
  invoice_number: string;
  type: string;
  counterparty_name: string | null;
  issue_date: string;
  total_amount: number;
}

export type InvoiceTag = 'na' | 'iva_favor' | 'retefuente';

interface InvoiceSelectorProps {
  invoiceId: string | null;
  tags: InvoiceTag[];
  transactionType: string;
  onChange: (invoiceId: string | null, tags: InvoiceTag[]) => void;
  className?: string;
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
  retefuente: { label: 'Retefuente', icon: Receipt, colorClass: 'text-accent', description: 'Sin factura, con retención' },
};

export default function InvoiceSelector({ invoiceId, tags, transactionType, onChange, className }: InvoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  const invoiceTypeFilter = transactionType === 'ingreso' ? 'venta' : transactionType === 'egreso' ? 'compra' : null;

  useEffect(() => {
    if (!open || loaded) return;
    const fetchInvoices = async () => {
      const query = supabase
        .from('invoices')
        .select('id, invoice_number, type, counterparty_name, issue_date, total_amount')
        .eq('status', 'confirmed')
        .order('issue_date', { ascending: false })
        .limit(200);

      const { data } = await query;
      setInvoices((data as InvoiceOption[]) || []);
      setLoaded(true);
    };
    fetchInvoices();
  }, [open, loaded]);

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
        formatCurrency(inv.total_amount).toLowerCase().includes(q)
      );
    }
    return result;
  }, [invoices, search, invoiceTypeFilter]);

  const selectedInvoice = invoices.find(inv => inv.id === invoiceId);

  const toggleTag = (tag: InvoiceTag) => {
    const newTags = tags.includes(tag)
      ? tags.filter(t => t !== tag)
      : [...tags, tag];
    
    // N/A is mutually exclusive with an invoice
    if (tag === 'na' && !tags.includes('na') && invoiceId) {
      onChange(null, newTags);
    } else {
      onChange(invoiceId, newTags);
    }
  };

  const removeTag = (tag: InvoiceTag) => {
    onChange(invoiceId, tags.filter(t => t !== tag));
  };

  const selectInvoice = (id: string) => {
    // Selecting an invoice removes N/A tag if present
    const newTags = tags.filter(t => t !== 'na');
    onChange(id, newTags);
    setOpen(false);
    setSearch('');
  };

  const clearInvoice = () => {
    onChange(null, tags);
  };

  const hasAnySelection = !!invoiceId || tags.length > 0;

  // Available tags for this transaction type
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
      <Popover open={open} onOpenChange={setOpen}>
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
        <PopoverContent className="w-[380px] p-0" align="start">
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

            {/* Separator */}
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
              Facturas confirmadas
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
                return (
                  <button
                    key={inv.id}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center gap-2 border-b border-border/50',
                      inv.id === invoiceId && 'bg-accent/10'
                    )}
                    onClick={() => selectInvoice(inv.id)}
                  >
                    <span className="font-medium shrink-0">
                      {prefix}-{inv.invoice_number}
                    </span>
                    <span className="text-muted-foreground truncate flex-1">
                      {inv.counterparty_name || 'Sin nombre'}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {inv.issue_date}
                    </span>
                    <span className="font-medium shrink-0">
                      {formatCurrency(inv.total_amount)}
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
