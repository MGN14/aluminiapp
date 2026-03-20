import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, Banknote, ShoppingCart, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Link } from 'react-router-dom';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface Props {
  year: number;
  periodLabel: string;
}

const RANK_COLORS = ['text-yellow-500', 'text-muted-foreground', 'text-amber-700'];

export default function OperationalSummaryCards({ year, periodLabel }: Props) {
  const [totalCxC, setTotalCxC] = useState(0);
  const [cxcCount, setCxcCount] = useState(0);
  const [totalAnticipos, setTotalAnticipos] = useState(0);
  const [anticiposCount, setAnticiposCount] = useState(0);
  const [topBuyers, setTopBuyers] = useState<[string, number][]>([]);
  const [totalComprasBase, setTotalComprasBase] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      // 1. Cuentas por Cobrar - sales invoices with pending balance
      const invoicesPromise = supabase
        .from('invoices')
        .select('id, total_amount, counterparty_name, retefuente_cliente_amount')
        .eq('type', 'venta')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate);

      // 2. Anticipos - income transactions without invoice, with responsible, not "otros" category
      const anticiposPromise = supabase
        .from('transactions')
        .select('id, amount, responsible_id, category')
        .eq('type', 'ingreso')
        .is('invoice_id', null)
        .is('deleted_at', null)
        .gte('date', startDate)
        .lte('date', endDate);

      // 3. Top clientes - sales invoices
      const comprasPromise = supabase
        .from('invoices')
        .select('counterparty_name, subtotal_base')
        .eq('type', 'venta')
        .eq('status', 'confirmed')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate);

      const [invoicesRes, anticiposRes, comprasRes] = await Promise.all([
        invoicesPromise,
        anticiposPromise,
        comprasPromise,
      ]);

      // --- CxC ---
      if (invoicesRes.data && invoicesRes.data.length > 0) {
        const invoiceIds = invoicesRes.data.map(i => i.id);

        const [directRes, matchRes, advanceRes] = await Promise.all([
          supabase
            .from('transactions')
            .select('invoice_id, amount')
            .is('deleted_at', null)
            .in('invoice_id', invoiceIds),
          supabase
            .from('invoice_transaction_matches')
            .select('invoice_id, matched_amount')
            .in('invoice_id', invoiceIds),
          supabase
            .from('initial_state_details')
            .select('invoice_id, amount')
            .eq('field_type', 'anticipos_de_clientes')
            .in('invoice_id', invoiceIds),
        ]);

        const payments = new Map<string, number>();
        (directRes.data || []).forEach(p => {
          if (p.invoice_id) {
            payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.amount ?? 0));
          }
        });
        (matchRes.data || []).forEach(p => {
          payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.matched_amount));
        });
        // Count linked advance payments from initial state
        ((advanceRes.data || []) as any[]).forEach(p => {
          if (p.invoice_id) {
            payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.amount ?? 0));
          }
        });

        let pendingTotal = 0;
        let pendingCount = 0;
        invoicesRes.data.forEach(inv => {
          const paid = payments.get(inv.id) || 0;
          const retefuenteCliente = (inv as any).retefuente_cliente_amount ?? 0;
          const pending = Math.max(0, inv.total_amount - paid - retefuenteCliente);
          if (pending > 0) {
            pendingTotal += pending;
            pendingCount++;
          }
        });
        setTotalCxC(pendingTotal);
        setCxcCount(pendingCount);
      } else {
        setTotalCxC(0);
        setCxcCount(0);
      }

      // --- Anticipos ---
      if (anticiposRes.data) {
        // Need responsible names to exclude "Banco"
        const respIds = [...new Set(anticiposRes.data.filter(t => t.responsible_id).map(t => t.responsible_id!))];
        let respMap = new Map<string, string>();
        if (respIds.length > 0) {
          const { data: resps } = await supabase
            .from('responsibles')
            .select('id, name')
            .in('id', respIds);
          if (resps) resps.forEach(r => respMap.set(r.id, r.name));
        }

        const filtered = anticiposRes.data.filter(t => {
          const cat = (t.category || '').trim().toLowerCase();
          const hasResp = Boolean(t.responsible_id);
          const isExcluded = cat === 'otros';
          const respName = t.responsible_id ? respMap.get(t.responsible_id) : null;
          const isBanco = respName?.toLowerCase() === 'banco';
          return hasResp && !isExcluded && !isBanco;
        });

        setTotalAnticipos(filtered.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0));
        setAnticiposCount(filtered.length);
      } else {
        setTotalAnticipos(0);
        setAnticiposCount(0);
      }

      // --- Top 3 Compradores ---
      if (comprasRes.data && comprasRes.data.length > 0) {
        const bySupplier = new Map<string, number>();
        let totalBase = 0;
        comprasRes.data.forEach(inv => {
          const name = inv.counterparty_name || 'Sin nombre';
          bySupplier.set(name, (bySupplier.get(name) || 0) + inv.subtotal_base);
          totalBase += inv.subtotal_base;
        });
        const sorted = Array.from(bySupplier.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3) as [string, number][];
        setTopBuyers(sorted);
        setTotalComprasBase(totalBase);
      } else {
        setTopBuyers([]);
        setTotalComprasBase(0);
      }

      setLoading(false);
    };

    fetchAll();
  }, [year]);

  if (loading) return null;

  return (
    <TooltipProvider>
      {/* Total Cuentas por Cobrar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cuentas por Cobrar
          </CardTitle>
          <div className="p-2 rounded-lg bg-destructive/10">
            <Receipt className="h-4 w-4 text-destructive" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-destructive">
            {formatCurrency(totalCxC)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {cxcCount} factura{cxcCount !== 1 ? 's' : ''} pendientes • {year}
          </div>
          <Link to="/reports" className="text-xs hover:underline mt-1 inline-block text-primary">
            Ver detalle →
          </Link>
        </CardContent>
      </Card>

      {/* Total Anticipos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Anticipos
          </CardTitle>
          <div className="p-2 rounded-lg bg-warning/10">
            <Banknote className="h-4 w-4 text-warning" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold text-warning">
            {formatCurrency(totalAnticipos)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {anticiposCount} transacción{anticiposCount !== 1 ? 'es' : ''} • {year}
          </div>
          <Link to="/reports" className="text-xs hover:underline mt-1 inline-block text-primary">
            Ver detalle →
          </Link>
        </CardContent>
      </Card>

      {/* Top 3 Clientes (Ventas) */}
      <Card className="sm:col-span-2 lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-foreground">
              Top 3 Clientes
            </CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Clientes con mayor facturación de venta confirmada (base, sin IVA) en {year}.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="p-2 rounded-lg bg-success/10">
            <ShoppingCart className="h-4 w-4 text-success" />
          </div>
        </CardHeader>
        <CardContent>
          {topBuyers.length > 0 ? (
            <div className="space-y-3">
              {topBuyers.map(([name, total], index) => {
                const pct = totalComprasBase > 0 ? ((total / totalComprasBase) * 100).toFixed(0) : '0';
                return (
                  <div key={name} className="flex items-center gap-3">
                    <span className={`font-bold text-lg w-6 text-center shrink-0 ${RANK_COLORS[index]}`}>
                      {index + 1}
                    </span>
                    <span className="text-sm text-foreground truncate flex-1">{name}</span>
                    <div className="text-right shrink-0">
                      <span className="font-semibold text-sm text-foreground whitespace-nowrap">{formatCurrency(total)}</span>
                      <span className="text-xs text-muted-foreground ml-1">({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <ShoppingCart className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Aún no hay facturas de venta confirmadas.</p>
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-4 pt-2 border-t border-border">
            {year}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
