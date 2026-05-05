import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCounterpartyResolver, resolveCounterpartyName } from '@/lib/counterpartyResolver';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Info, AlertCircle, Receipt, Search, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format, differenceInDays, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

type AgingBucket = 'corriente' | '1-30' | '31-60' | '61-90' | '90+';

interface InvoiceWithAging {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  responsible_id: string | null;
  issue_date: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
  pending: number;
  dias_credito: number;
  days_remaining: number; // positive = days left, negative = days overdue
  bucket: AgingBucket;
  status: 'pagada' | 'parcial' | 'pendiente';
}

const bucketConfig: Record<AgingBucket, { label: string; color: string; bgColor: string; borderColor: string; icon: typeof CheckCircle2; chartColor: string }> = {
  corriente: { label: 'Corriente', color: 'text-success', bgColor: 'bg-success/10', borderColor: 'border-success/30', icon: CheckCircle2, chartColor: 'hsl(152, 69%, 40%)' },
  '1-30': { label: '1–30 días', color: 'text-warning', bgColor: 'bg-warning/10', borderColor: 'border-warning/30', icon: Clock, chartColor: 'hsl(45, 93%, 47%)' },
  '31-60': { label: '31–60 días', color: 'text-orange-500', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/30', icon: AlertTriangle, chartColor: 'hsl(24, 95%, 53%)' },
  '61-90': { label: '61–90 días', color: 'text-destructive', bgColor: 'bg-destructive/10', borderColor: 'border-destructive/30', icon: AlertTriangle, chartColor: 'hsl(0, 72%, 56%)' },
  '90+': { label: '+90 días', color: 'text-destructive', bgColor: 'bg-destructive/15', borderColor: 'border-destructive/40', icon: AlertCircle, chartColor: 'hsl(0, 84%, 40%)' },
};

function getBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'corriente';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export default function AccountsPayableReport() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [searchQuery, setSearchQuery] = useState('');
  const [bucketFilter, setBucketFilter] = useState<string>('all');
  const counterpartyResolver = useCounterpartyResolver();

  const { data, isLoading } = useQuery({
    queryKey: ['accounts-payable', user?.id, year],
    queryFn: async () => {
      if (!user) return null;

      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const { data: invoices, error: invErr } = await supabase
        .from('invoices')
        .select('id, invoice_number, counterparty_name, responsible_id, issue_date, due_date, total_amount, status, type, dias_credito')
        .eq('type', 'compra')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate)
        .order('issue_date', { ascending: false });

      if (invErr) throw invErr;
      if (!invoices?.length) return { payables: [] };

      const invoiceIds = invoices.map(i => i.id);

      // Lo aplicado a una factura = transacciones directas + matches manuales +
      // anticipos a proveedores del estado financiero inicial vinculados a la
      // factura. Sin la 3ra fuente, una factura con anticipo pre-cargado
      // muestra saldo pendiente inflado.
      const [directRes, matchRes, advanceRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, invoice_id, amount')
          .is('deleted_at', null)
          .in('invoice_id', invoiceIds),
        supabase
          .from('invoice_transaction_matches')
          .select('invoice_id, matched_amount')
          .in('invoice_id', invoiceIds),
        supabase
          .from('initial_state_details')
          .select('invoice_id, amount')
          .eq('field_type', 'anticipos_a_proveedores')
          .in('invoice_id', invoiceIds),
      ]);

      const paymentsByInvoice = new Map<string, number>();
      (directRes.data || []).forEach(p => {
        if (p.invoice_id) {
          const current = paymentsByInvoice.get(p.invoice_id) || 0;
          paymentsByInvoice.set(p.invoice_id, current + Math.abs(p.amount ?? 0));
        }
      });
      (matchRes.data || []).forEach(p => {
        const current = paymentsByInvoice.get(p.invoice_id) || 0;
        paymentsByInvoice.set(p.invoice_id, current + Math.abs(p.matched_amount));
      });
      ((advanceRes.data || []) as Array<{ invoice_id: string | null; amount: number }>).forEach(a => {
        if (!a.invoice_id) return;
        const current = paymentsByInvoice.get(a.invoice_id) || 0;
        paymentsByInvoice.set(a.invoice_id, current + Math.abs(Number(a.amount ?? 0)));
      });

      const today = new Date();
      const payables: InvoiceWithAging[] = invoices.map(inv => {
        const diasCredito = (inv as any).dias_credito ?? 0;
        // No auto-paid shortcut: stays pendiente until actual conciliation
        // registers money against it. Siigo ventas/compras were landing directly
        // in "Facturas pagadas" because of the old contado=auto-paid logic.
        const rawPaid = paymentsByInvoice.get(inv.id) || 0;
        const paid = rawPaid;
        const pending = Math.max(0, inv.total_amount - paid);
        const dueDate = inv.due_date || addDays(new Date(inv.issue_date), diasCredito).toISOString().slice(0, 10);
        const daysRemaining = differenceInDays(new Date(dueDate), today);
        const daysOverdue = -daysRemaining;
        let status: 'pagada' | 'parcial' | 'pendiente' = 'pendiente';
        if (pending <= 0) status = 'pagada';
        else if (paid > 0) status = 'parcial';

        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          counterparty_name: inv.counterparty_name,
          responsible_id: (inv as { responsible_id?: string | null }).responsible_id ?? null,
          issue_date: inv.issue_date,
          due_date: dueDate,
          total_amount: inv.total_amount,
          paid_amount: paid,
          pending,
          dias_credito: diasCredito,
          days_remaining: daysRemaining,
          bucket: getBucket(daysOverdue),
          status,
        };
      });

      return { payables: payables.filter(r => r.pending > 0).sort((a, b) => a.days_remaining - b.days_remaining) };
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    let result = data?.payables || [];
    if (bucketFilter !== 'all') {
      result = result.filter(r => r.bucket === bucketFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        (r.counterparty_name || '').toLowerCase().includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [data, bucketFilter, searchQuery]);

  const totalPending = useMemo(() => filtered.reduce((s, r) => s + r.pending, 0), [filtered]);

  const bucketSummary = useMemo(() => {
    const all = data?.payables || [];
    const buckets: Record<AgingBucket, { count: number; total: number }> = {
      corriente: { count: 0, total: 0 },
      '1-30': { count: 0, total: 0 },
      '31-60': { count: 0, total: 0 },
      '61-90': { count: 0, total: 0 },
      '90+': { count: 0, total: 0 },
    };
    all.forEach(inv => {
      buckets[inv.bucket].count++;
      buckets[inv.bucket].total += inv.pending;
    });
    return buckets;
  }, [data]);

  const chartData = useMemo(() => {
    return (Object.entries(bucketConfig) as [AgingBucket, typeof bucketConfig[AgingBucket]][]).map(([key, cfg]) => ({
      name: cfg.label,
      monto: bucketSummary[key].total,
      count: bucketSummary[key].count,
      fill: cfg.chartColor,
    }));
  }, [bucketSummary]);

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
        {/* Header */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Lo que debo</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Facturas de compra con saldo pendiente, clasificadas por antigüedad de vencimiento.</p>
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

        {/* Total + Aging Buckets */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Total card */}
          <Card className="col-span-2 sm:col-span-3 lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle>
              <div className="p-1.5 rounded-lg bg-warning/10">
                <Receipt className="h-3.5 w-3.5 text-warning" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-lg font-bold text-warning">{formatCurrency(totalPending)}</div>
              <p className="text-xs text-muted-foreground">{filtered.length} facturas</p>
            </CardContent>
          </Card>

          {/* Bucket cards */}
          {(Object.entries(bucketConfig) as [AgingBucket, typeof bucketConfig[AgingBucket]][]).map(([key, cfg]) => {
            const summary = bucketSummary[key];
            const Icon = cfg.icon;
            const isActive = bucketFilter === key;
            return (
              <Card
                key={key}
                className={cn(
                  'cursor-pointer transition-all hover:shadow-md',
                  isActive && `ring-2 ring-offset-1 ${cfg.borderColor}`
                )}
                onClick={() => setBucketFilter(prev => prev === key ? 'all' : key)}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 px-3 pt-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{cfg.label}</CardTitle>
                  <div className={cn('p-1 rounded-md', cfg.bgColor)}>
                    <Icon className={cn('h-3 w-3', cfg.color)} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-3 pb-3">
                  <div className={cn('text-sm font-bold', cfg.color)}>{formatCurrency(summary.total)}</div>
                  <p className="text-xs text-muted-foreground">{summary.count} factura{summary.count !== 1 ? 's' : ''}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Aging Chart */}
        {(data?.payables?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Por lo que llevan sin pagar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={60} />
                    <RechartsTooltip
                      formatter={(value: number) => [formatCurrency(value), 'Monto']}
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '13px' }}
                      labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    />
                    <Bar dataKey="monto" radius={[6, 6, 0, 0]} maxBarSize={60}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[200px] max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por proveedor o número..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          {bucketFilter !== 'all' && (
            <Badge
              variant="outline"
              className="cursor-pointer hover:bg-muted h-9 px-3 flex items-center gap-1"
              onClick={() => setBucketFilter('all')}
            >
              {bucketConfig[bucketFilter as AgingBucket]?.label} ✕
            </Badge>
          )}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    <TableHead className="font-semibold"># Factura</TableHead>
                    <TableHead className="font-semibold">Proveedor</TableHead>
                    <TableHead className="font-semibold">Emisión</TableHead>
                    <TableHead className="font-semibold">Vencimiento</TableHead>
                    <TableHead className="font-semibold text-right">Total</TableHead>
                    <TableHead className="font-semibold text-right">Pagado</TableHead>
                    <TableHead className="font-semibold text-right">Pendiente</TableHead>
                    <TableHead className="font-semibold text-center">Días</TableHead>
                    <TableHead className="font-semibold text-center">Lleva sin pagar</TableHead>
                    <TableHead className="font-semibold text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Cargando datos...</TableCell>
                    </TableRow>
                  ) : !filtered.length ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">No hay facturas de compra con saldo pendiente.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((inv) => {
                      const cfg = bucketConfig[inv.bucket];
                      const isOverdue = inv.days_remaining < 0;
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="text-sm font-medium">{inv.invoice_number}</TableCell>
                          <TableCell className="text-sm">{resolveCounterpartyName(inv.counterparty_name, inv.responsible_id, counterpartyResolver)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es })}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(inv.due_date), 'dd MMM yyyy', { locale: es })}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">{formatCurrency(inv.total_amount)}</TableCell>
                          <TableCell className="text-right text-sm text-success">{formatCurrency(inv.paid_amount)}</TableCell>
                          <TableCell className="text-right text-sm font-bold text-destructive">{formatCurrency(inv.pending)}</TableCell>
                          <TableCell className={cn(
                            "text-center text-sm font-semibold",
                            isOverdue ? 'text-destructive' : 'text-success'
                          )}>
                            {isOverdue ? `${Math.abs(inv.days_remaining)}d vencido` : `${inv.days_remaining}d`}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={cn('text-xs', cfg.bgColor, cfg.color, cfg.borderColor)}>
                              {cfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">{statusBadge(inv.status)}</TableCell>
                        </TableRow>
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
