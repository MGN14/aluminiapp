import { useMemo } from 'react';
import { Invoice } from '@/types/invoice';
import { DollarSign, Receipt } from 'lucide-react';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

interface Props {
  invoices: Invoice[];
  type: 'venta' | 'compra';
}

export default function InvoiceMicroSummary({ invoices, type }: Props) {
  const { total, iva } = useMemo(() => {
    // Excluir las anuladas totalmente por NC: no son facturación válida.
    const confirmed = invoices.filter(
      i => i.status === 'confirmed' && (i as { void_type?: string | null }).void_type !== 'total',
    );
    return {
      total: confirmed.reduce((s, i) => s + i.total_amount, 0),
      iva: confirmed.reduce((s, i) => s + i.iva_amount, 0),
    };
  }, [invoices]);

  const label1 = type === 'venta' ? 'Total facturado' : 'Total comprado';
  const label2 = type === 'venta' ? 'IVA generado' : 'IVA descontable';

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <DollarSign className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label1}</p>
          <p className="text-lg font-semibold tracking-tight">{formatCurrency(total)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/50">
          <Receipt className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label2}</p>
          <p className="text-lg font-semibold tracking-tight">{formatCurrency(iva)}</p>
        </div>
      </div>
    </div>
  );
}
