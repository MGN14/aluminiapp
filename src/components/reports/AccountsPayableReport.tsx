import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Info, AlertCircle, Receipt } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

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
}

export default function AccountsPayableReport() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);

  const { data, isLoading } = useQuery({
    queryKey: ['accounts-payable', user?.id, year],
    queryFn: async () => {
      if (!user) return null;

      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const { data: invoices, error: invErr } = await supabase
        .from('invoices')
        .select('id, invoice_number, counterparty_name, issue_date, total_amount, status, type')
        .eq('user_id', user.id)
        .eq('type', 'compra')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate)
        .order('issue_date', { ascending: false });

      if (invErr) throw invErr;
      if (!invoices?.length) return { payables: [] };

      const invoiceIds = invoices.map(i => i.id);

      const { data: directPayments } = await supabase
        .from('transactions')
        .select('id, invoice_id, amount')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .in('invoice_id', invoiceIds);

      const { data: matchPayments } = await supabase
        .from('invoice_transaction_matches')
        .select('invoice_id, matched_amount')
        .eq('user_id', user.id)
        .in('invoice_id', invoiceIds);

      const paymentsByInvoice = new Map<string, number>();
      (directPayments || []).forEach(p => {
        if (p.invoice_id) {
          const current = paymentsByInvoice.get(p.invoice_id) || 0;
          paymentsByInvoice.set(p.invoice_id, current + Math.abs(p.amount ?? 0));
        }
      });
      (matchPayments || []).forEach(p => {
        const current = paymentsByInvoice.get(p.invoice_id) || 0;
        paymentsByInvoice.set(p.invoice_id, current + Math.abs(p.matched_amount));
      });

      const today = new Date();
      const payables: InvoiceWithPayments[] = invoices.map(inv => {
        const paid = paymentsByInvoice.get(inv.id) || 0;
        const pending = Math.max(0, inv.total_amount - paid);
        const daysSince = differenceInDays(today, new Date(inv.issue_date));
        let status: 'pagada' | 'parcial' | 'pendiente' = 'pendiente';
        if (pending <= 0) status = 'pagada';
        else if (paid > 0) status = 'parcial';
        return { id: inv.id, invoice_number: inv.invoice_number, counterparty_name: inv.counterparty_name, issue_date: inv.issue_date, total_amount: inv.total_amount, paid_amount: paid, pending, days_since: daysSince, status };
      });

      return { payables: payables.filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending) };
    },
    enabled: !!user,
  });

  const totalPending = useMemo(() => {
    return (data?.payables || []).reduce((s, r) => s + r.pending, 0);
  }, [data]);

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

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Cuentas por Pagar</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Facturas de compra registradas con saldo pendiente de pago a proveedores.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Cuentas por Pagar</CardTitle>
            <div className="p-2 rounded-lg bg-warning/10">
              <Receipt className="h-4 w-4 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{formatCurrency(totalPending)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.payables.length ?? 0} factura{(data?.payables.length ?? 0) !== 1 ? 's' : ''} pendientes • {year}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    <TableHead className="font-semibold"># Factura</TableHead>
                    <TableHead className="font-semibold">Proveedor</TableHead>
                    <TableHead className="font-semibold">Emisión</TableHead>
                    <TableHead className="font-semibold text-right">Total</TableHead>
                    <TableHead className="font-semibold text-right">Pagado</TableHead>
                    <TableHead className="font-semibold text-right">Pendiente</TableHead>
                    <TableHead className="font-semibold text-center">Días</TableHead>
                    <TableHead className="font-semibold text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Cargando datos...</TableCell>
                    </TableRow>
                  ) : !data?.payables.length ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">No hay facturas de compra con saldo pendiente.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.payables.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="text-sm font-medium">{inv.invoice_number}</TableCell>
                        <TableCell className="text-sm">{inv.counterparty_name || 'Sin nombre'}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es })}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatCurrency(inv.total_amount)}</TableCell>
                        <TableCell className="text-right text-sm text-success">{formatCurrency(inv.paid_amount)}</TableCell>
                        <TableCell className="text-right text-sm font-bold text-destructive">{formatCurrency(inv.pending)}</TableCell>
                        <TableCell className={cn(
                          "text-center text-sm font-medium",
                          inv.days_since > 90 ? 'text-destructive' : inv.days_since > 30 ? 'text-warning' : 'text-muted-foreground'
                        )}>
                          {inv.days_since}d
                        </TableCell>
                        <TableCell className="text-center">{statusBadge(inv.status)}</TableCell>
                      </TableRow>
                    ))
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
