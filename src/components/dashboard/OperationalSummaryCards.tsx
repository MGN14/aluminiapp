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

export interface OperationalData {
  totalCxC: number;
  cxcCount: number;
  totalAnticipos: number;
  anticiposCount: number;
  topBuyers: [string, number][];
  totalComprasBase: number;
  loading: boolean;
}

export function useOperationalData(year: number): OperationalData {
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

      const invoicesPromise = supabase
        .from('invoices')
        .select('id, total_amount, subtotal_base, counterparty_name, retefuente_cliente_amount, retefuente_cliente_rate')
        .eq('type', 'venta')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate);

      const anticiposPromise = supabase
        .from('transactions')
        .select('id, amount, responsible_id, category, category_id, categories!transactions_category_id_fkey(name), invoice_id')
        .eq('type', 'ingreso')
        .is('invoice_id', null)
        .is('deleted_at', null)
        .gte('date', startDate)
        .lte('date', endDate);

      const comprasPromise = supabase
        .from('invoices')
        .select('counterparty_name, subtotal_base, responsible_id')
        .eq('type', 'venta')
        .eq('status', 'confirmed')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate);

      const initialCxCPromise = supabase
        .from('initial_state_details')
        .select('id, amount, invoice_id')
        .eq('field_type', 'cuentas_por_cobrar');

      const initialAnticiposPromise = supabase
        .from('initial_state_details')
        .select('id, amount, invoice_id')
        .eq('field_type', 'anticipos_de_clientes');

      const [invoicesRes, anticiposRes, comprasRes, initialCxCRes, initialAnticiposRes] = await Promise.all([
        invoicesPromise, anticiposPromise, comprasPromise, initialCxCPromise, initialAnticiposPromise,
      ]);

      if (invoicesRes.error) throw invoicesRes.error;
      if (anticiposRes.error) throw anticiposRes.error;
      if (comprasRes.error) throw comprasRes.error;
      if (initialCxCRes.error) throw initialCxCRes.error;
      if (initialAnticiposRes.error) throw initialAnticiposRes.error;

      // --- CxC ---
      const initialCxCTotal = (initialCxCRes.data || []).reduce((s, d) => s + (d.amount ?? 0), 0);

      if (invoicesRes.data && invoicesRes.data.length > 0) {
        const invoiceIds = invoicesRes.data.map(i => i.id);
        const [directRes, matchRes, advanceRes] = await Promise.all([
          supabase.from('transactions').select('invoice_id, amount').is('deleted_at', null).in('invoice_id', invoiceIds),
          supabase.from('invoice_transaction_matches').select('invoice_id, matched_amount').in('invoice_id', invoiceIds),
          supabase.from('initial_state_details').select('invoice_id, amount').eq('field_type', 'anticipos_de_clientes').in('invoice_id', invoiceIds),
        ]);

        const payments = new Map<string, number>();
        (directRes.data || []).forEach(p => { if (p.invoice_id) payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.amount ?? 0)); });
        (matchRes.data || []).forEach(p => { payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.matched_amount)); });
        ((advanceRes.data || []) as any[]).forEach(p => { if (p.invoice_id) payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.amount ?? 0)); });

        let pendingTotal = 0;
        let pendingCount = 0;
        invoicesRes.data.forEach(inv => {
          const paid = payments.get(inv.id) || 0;
          const savedRetefuente = (inv as any).retefuente_cliente_amount ?? 0;
          const rawRate = (inv as any).retefuente_cliente_rate;
          const hasExplicitRate = rawRate !== null && rawRate !== undefined;
          const effectiveRate = hasExplicitRate ? rawRate : 0.025;
          const retefuenteCliente = savedRetefuente > 0 ? savedRetefuente : Math.round(((inv as any).subtotal_base ?? 0) * effectiveRate);
          const pending = Math.max(0, inv.total_amount - paid - retefuenteCliente);
          if (pending > 0) { pendingTotal += pending; pendingCount++; }
        });
        setTotalCxC(pendingTotal + initialCxCTotal);
        setCxcCount(pendingCount);
      } else {
        setTotalCxC(initialCxCTotal);
        setCxcCount(0);
      }

      // --- Anticipos ---
      if (anticiposRes.data) {
        const respIds = [...new Set(anticiposRes.data.filter(t => t.responsible_id).map(t => t.responsible_id!))];
        let respMap = new Map<string, string>();
        if (respIds.length > 0) {
          const { data: resps } = await supabase.from('responsibles').select('id, name').in('id', respIds);
          if (resps) resps.forEach(r => respMap.set(r.id, r.name));
        }
        const filtered = anticiposRes.data.filter((t: any) => {
          const catName = (t.categories?.name || t.category || '').trim().toLowerCase();
          const hasResp = Boolean(t.responsible_id);
          const isVentas = catName === 'ventas';
          const respName = t.responsible_id ? respMap.get(t.responsible_id) : null;
          const isRespOtros = respName?.toLowerCase() === 'otros';
          return hasResp && isVentas && !isRespOtros;
        });
        const unreconciledInitialAnticipos = (initialAnticiposRes.data || []).filter((d: any) => !d.invoice_id).reduce((s, d) => s + Math.abs(d.amount ?? 0), 0);
        setTotalAnticipos(filtered.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0) + unreconciledInitialAnticipos);
        setAnticiposCount(filtered.length);
      } else {
        const unreconciledInitialAnticipos = (initialAnticiposRes.data || []).filter((d: any) => !d.invoice_id).reduce((s, d) => s + Math.abs(d.amount ?? 0), 0);
        setTotalAnticipos(unreconciledInitialAnticipos);
        setAnticiposCount(0);
      }

      // --- Top 3 Compradores ---
      // Agrupamos por responsible.name (el beneficiario vinculado del banco)
      // para consolidar las distintas variantes de nombre que aparezcan en
      // facturas. counterparty_name es solo fallback si la factura todavía
      // no fue vinculada a un responsible.
      if (comprasRes.data && comprasRes.data.length > 0) {
        const respIds = [...new Set(
          (comprasRes.data as any[])
            .map(i => i.responsible_id)
            .filter((id): id is string => Boolean(id))
        )];
        const respNameById = new Map<string, string>();
        if (respIds.length > 0) {
          const { data: resps } = await supabase
            .from('responsibles')
            .select('id, name')
            .in('id', respIds);
          (resps || []).forEach(r => respNameById.set(r.id, r.name));
        }

        const bySupplier = new Map<string, number>();
        let totalBase = 0;
        (comprasRes.data as any[]).forEach(inv => {
          // Prioridad: responsible.name (vinculado al banco) → counterparty_name (Siigo)
          const respName = inv.responsible_id ? respNameById.get(inv.responsible_id) : null;
          const name = respName ?? inv.counterparty_name ?? 'Sin nombre';
          bySupplier.set(name, (bySupplier.get(name) || 0) + Number(inv.subtotal_base ?? 0));
          totalBase += Number(inv.subtotal_base ?? 0);
        });
        const sorted = Array.from(bySupplier.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3) as [string, number][];
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

  return { totalCxC, cxcCount, totalAnticipos, anticiposCount, topBuyers, totalComprasBase, loading };
}

// ── Individual Card Components ──

export function CxCCard({ totalCxC, cxcCount, year }: { totalCxC: number; cxcCount: number; year: number }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Lo que me deben</CardTitle>
        <div className="w-8 h-8 rounded-xl bg-destructive/10 flex items-center justify-center">
          <Receipt className="h-4 w-4 text-destructive" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold text-destructive">{formatCurrency(totalCxC)}</div>
        <div className="text-xs text-muted-foreground mt-1">{cxcCount} factura{cxcCount !== 1 ? 's' : ''} pendientes • {year}</div>
        <Link to="/reports" className="text-xs hover:underline mt-1 inline-block text-primary">Ver detalle →</Link>
      </CardContent>
    </Card>
  );
}

export function AnticiposCard({ totalAnticipos, anticiposCount, year }: { totalAnticipos: number; anticiposCount: number; year: number }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Anticipos</CardTitle>
        <div className="w-8 h-8 rounded-xl bg-warning/10 flex items-center justify-center">
          <Banknote className="h-4 w-4 text-warning" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold text-warning">{formatCurrency(totalAnticipos)}</div>
        <div className="text-xs text-muted-foreground mt-1">{anticiposCount} transacción{anticiposCount !== 1 ? 'es' : ''} • {year}</div>
        <Link to="/reports" className="text-xs hover:underline mt-1 inline-block text-primary">Ver detalle →</Link>
      </CardContent>
    </Card>
  );
}

export function TopBuyersCard({ topBuyers, totalComprasBase, year }: { topBuyers: [string, number][]; totalComprasBase: number; year: number }) {
  return (
    <TooltipProvider>
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-foreground">Top 3 Clientes</CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Clientes con mayor facturación de venta confirmada (base, sin IVA) en {year}.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="w-8 h-8 rounded-xl bg-success/10 flex items-center justify-center">
            <ShoppingCart className="h-4 w-4 text-success" />
          </div>
        </CardHeader>
        <CardContent>
          {topBuyers.length > 0 ? (
            <div className="space-y-3">
              {topBuyers.map(([name, total], index) => {
                const pct = totalComprasBase > 0 ? ((total / totalComprasBase) * 100).toFixed(0) : '0';
                return (
                  <div key={name} className="flex items-start gap-3">
                    <span className={`font-bold text-lg w-6 text-center shrink-0 leading-tight ${RANK_COLORS[index]}`}>{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{name}</p>
                      {/* Mobile: monto debajo */}
                      <p className="text-xs mt-0.5 sm:hidden">
                        <span className="font-semibold text-foreground tabular-nums">{formatCurrency(total)}</span>
                        <span className="text-muted-foreground ml-1.5">({pct}%)</span>
                      </p>
                    </div>
                    {/* Desktop: monto al lado */}
                    <div className="hidden sm:block text-right shrink-0">
                      <span className="font-semibold text-sm text-foreground whitespace-nowrap tabular-nums">{formatCurrency(total)}</span>
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
          <div className="text-xs text-muted-foreground mt-4 pt-2 border-t border-border">{year}</div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

// Legacy default export for backward compat
export default function OperationalSummaryCards({ year, periodLabel }: Props) {
  const data = useOperationalData(year);
  if (data.loading) return null;
  return (
    <TooltipProvider>
      <CxCCard totalCxC={data.totalCxC} cxcCount={data.cxcCount} year={year} />
      <AnticiposCard totalAnticipos={data.totalAnticipos} anticiposCount={data.anticiposCount} year={year} />
      <TopBuyersCard topBuyers={data.topBuyers} totalComprasBase={data.totalComprasBase} year={year} />
    </TooltipProvider>
  );
}
