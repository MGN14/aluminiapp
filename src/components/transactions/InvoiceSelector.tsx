import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FileText, Search, X } from 'lucide-react';

interface InvoiceOption {
  id: string;
  invoice_number: string;
  type: string;
  counterparty_name: string | null;
  issue_date: string;
  total_amount: number;
}

interface InvoiceSelectorProps {
  value: string | null;
  transactionType: string; // 'ingreso' | 'egreso' | 'transferencia'
  onChange: (invoiceId: string | null) => void;
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

export default function InvoiceSelector({ value, transactionType, onChange, className }: InvoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Determine invoice type filter based on transaction type
  const invoiceTypeFilter = transactionType === 'ingreso' ? 'venta' : transactionType === 'egreso' ? 'compra' : null;

  useEffect(() => {
    if (!open || loaded) return;
    const fetchInvoices = async () => {
      let query = supabase
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
    
    // Filter by type based on transaction type
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

  const selected = invoices.find(inv => inv.id === value);

  const handleSelect = (invoiceId: string | null) => {
    onChange(invoiceId);
    setOpen(false);
    setSearch('');
  };

  const label = selected
    ? `${selected.invoice_number}`
    : value === 'N/A'
    ? 'N/A'
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 text-xs justify-start font-normal w-full px-2',
            !label && 'text-muted-foreground',
            className,
          )}
        >
          {label ? (
            <span className="flex items-center gap-1 truncate">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{label}</span>
              <button
                className="ml-auto shrink-0 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); handleSelect(null); }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <span className="text-warning truncate">Pendiente</span>
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
        <div className="max-h-[250px] overflow-y-auto">
          {/* N/A option */}
          <button
            className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 border-b border-border text-muted-foreground"
            onClick={() => handleSelect('N/A')}
          >
            N/A — Sin factura asociada
          </button>
          
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
                    inv.id === value && 'bg-accent/10'
                  )}
                  onClick={() => handleSelect(inv.id)}
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
  );
}
