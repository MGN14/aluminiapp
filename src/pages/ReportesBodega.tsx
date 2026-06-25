import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { useInventoryData } from '@/hooks/useInventoryData';
import { parseScan } from '@/lib/qrLabel';
import { Input } from '@/components/ui/input';
import AppLayout from '@/components/layout/AppLayout';
import { Truck, ClipboardCheck, RefreshCw, AlertTriangle, Users, Clock, Search, PackageSearch, Package, Loader2 } from 'lucide-react';

function fmtMin(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function fmtCurrency(v: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
}
function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtDateTime(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ReportesBodega() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const dataSource = isGerencial ? 'gerencial' : 'dian';
  const { products, metrics } = useInventoryData(dataSource);

  // ── Tiempo de despacho ──
  const { data: despachos = [] } = useQuery({
    queryKey: ['rep-despachos', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: rems, error } = await (supabase.from('remisiones') as any)
        .select('id, number, beneficiary, verified_at, verified_units, status')
        .eq('status', 'despachado').not('verified_at', 'is', null)
        .order('verified_at', { ascending: false }).limit(25);
      if (error) throw error;
      const list = (rems || []) as Array<{ id: string; number: string; beneficiary: string | null; verified_at: string; verified_units: number | null }>;
      if (list.length === 0) return [];
      const ids = list.map(r => r.id);
      const { data: scans } = await (supabase as any).from('dispatch_scans').select('remision_id, scanned_at, operator_id').in('remision_id', ids);
      const first = new Map<string, string>();
      const ops = new Map<string, Set<string>>();
      for (const s of (scans || []) as Array<{ remision_id: string; scanned_at: string; operator_id: string | null }>) {
        const cur = first.get(s.remision_id);
        if (!cur || s.scanned_at < cur) first.set(s.remision_id, s.scanned_at);
        if (s.operator_id) { const set = ops.get(s.remision_id) ?? new Set<string>(); set.add(s.operator_id); ops.set(s.remision_id, set); }
      }
      return list.map(r => {
        const f = first.get(r.id);
        const mins = f && r.verified_at ? Math.max(0, Math.round((new Date(r.verified_at).getTime() - new Date(f).getTime()) / 60000)) : null;
        return { ...r, minutes: mins, operators: ops.get(r.id)?.size ?? 0 };
      });
    },
  });
  const despachoConTiempo = despachos.filter(d => d.minutes != null);
  const avgDespacho = despachoConTiempo.length ? Math.round(despachoConTiempo.reduce((s, d) => s + (d.minutes || 0), 0) / despachoConTiempo.length) : null;

  // ── Tiempo de inventario (conteos) ──
  const { data: counts = [] } = useQuery({
    queryKey: ['rep-counts', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('count_sessions')
        .select('id, started_at, ended_at, refs_count, units_count, diffs_count')
        .order('ended_at', { ascending: false }).limit(25);
      if (error) throw error;
      return (data || []) as Array<{ id: string; started_at: string | null; ended_at: string; refs_count: number; units_count: number; diffs_count: number }>;
    },
  });
  const countRows = counts.map(c => {
    const mins = c.started_at ? Math.max(0, Math.round((new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 60000)) : null;
    return { ...c, minutes: mins };
  });
  const avgConteo = (() => {
    const withT = countRows.filter(c => c.minutes != null);
    return withT.length ? Math.round(withT.reduce((s, c) => s + (c.minutes || 0), 0) / withT.length) : null;
  })();

  // ── Rotación + durabilidad (del inventario) ──
  const stockOf = (p: typeof products[number]) => (isGerencial ? p.teorico : p.stock_system);
  const topRotacion = useMemo(() => [...products].filter(p => p.rotation > 0).sort((a, b) => b.rotation - a.rotation).slice(0, 6), [products]);
  const slowMovers = useMemo(() => products
    .filter(p => p.avg_daily_sales === 0 && stockOf(p) > 0)
    .map(p => ({ p, value: stockOf(p) * (p.cost_per_unit || 0) }))
    .sort((a, b) => b.value - a.value), [products]); // eslint-disable-line react-hooks/exhaustive-deps
  const stuckValue = slowMovers.reduce((s, x) => s + x.value, 0);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-blue-600/10 flex items-center justify-center flex-shrink-0">
            <Truck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.6px' }}>Reportes de bodega</h1>
            <p className="text-sm text-muted-foreground">Trazabilidad, tiempos, rotación y alertas de la operación física</p>
          </div>
        </div>

        {/* Trazabilidad de bulto (para quejas) */}
        <SerialLookup />

        {/* Tiempo de despacho */}
        <Card icon={<Truck className="h-4 w-4 text-blue-600" />} title="Tiempo de despacho"
          right={avgDespacho != null ? <Avg label="promedio" value={fmtMin(avgDespacho)} /> : null}>
          {despachoConTiempo.length === 0 ? (
            <Empty>Aún no hay despachos cronometrados. Se mide desde el primer escaneo hasta “despachado” (modo por pedido).</Empty>
          ) : (
            <Table head={['Remisión', 'Cliente', 'Unds', 'Operarios', 'Tiempo']}>
              {despachoConTiempo.slice(0, 10).map(d => (
                <tr key={d.id}>
                  <Td className="font-semibold">{d.number}</Td>
                  <Td className="truncate max-w-[160px]">{d.beneficiary || '—'}</Td>
                  <Td className="text-right tabular-nums">{Number(d.verified_units) || 0}</Td>
                  <Td className="text-right">{d.operators > 1 ? <span className="inline-flex items-center gap-1 text-blue-600 font-semibold"><Users className="h-3 w-3" />{d.operators}</span> : (d.operators || 1)}</Td>
                  <Td className="text-right font-mono font-semibold">{fmtMin(d.minutes)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* Tiempo de inventario */}
        <Card icon={<ClipboardCheck className="h-4 w-4 text-orange-500" />} title="Tiempo de inventario"
          right={avgConteo != null ? <Avg label="promedio" value={fmtMin(avgConteo)} /> : null}>
          {countRows.length === 0 ? (
            <Empty>Aún no hay conteos registrados. Se mide desde el primer escaneo hasta “cerrar conteo”.</Empty>
          ) : (
            <Table head={['Fecha', 'Referencias', 'Unidades', 'Con diferencia', 'Tiempo']}>
              {countRows.slice(0, 10).map(c => (
                <tr key={c.id}>
                  <Td>{fmtDate(c.ended_at)}</Td>
                  <Td className="text-right tabular-nums">{c.refs_count}</Td>
                  <Td className="text-right tabular-nums">{Math.round(Number(c.units_count) || 0)}</Td>
                  <Td className="text-right tabular-nums">{c.diffs_count > 0 ? <span className="text-amber-600 font-semibold">{c.diffs_count}</span> : 0}</Td>
                  <Td className="text-right font-mono font-semibold">{fmtMin(c.minutes)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* Rotación */}
        <Card icon={<RefreshCw className="h-4 w-4 text-emerald-600" />} title="Rotación de inventario"
          right={<Avg label="días inv. prom." value={metrics.avgDaysOfInventory ? `${metrics.avgDaysOfInventory}d` : '—'} />}>
          {topRotacion.length === 0 ? (
            <Empty>Sin ventas en los últimos 30 días para calcular rotación.</Empty>
          ) : (
            <Table head={['Referencia', 'Stock', 'Venta/día', 'Días cobertura', 'Rotación']}>
              {topRotacion.map(p => (
                <tr key={p.id}>
                  <Td className="font-semibold truncate max-w-[180px]">{p.reference}</Td>
                  <Td className="text-right tabular-nums">{Math.round(stockOf(p))}</Td>
                  <Td className="text-right tabular-nums">{p.avg_daily_sales}</Td>
                  <Td className="text-right tabular-nums">{p.days_of_inventory}d</Td>
                  <Td className="text-right font-mono font-semibold text-emerald-600">{p.rotation.toFixed(2)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* Durabilidad / alertas (stock parado) */}
        <Card icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} title="Durabilidad — stock parado (sin movimiento 30d)"
          right={<Avg label="plata parada" value={fmtCurrency(stuckValue)} />}>
          {slowMovers.length === 0 ? (
            <Empty>Nada parado: todo lo que tenés stock tuvo movimiento en los últimos 30 días. 👏</Empty>
          ) : (
            <Table head={['Referencia', 'Stock', 'Costo unit.', 'Valor parado']}>
              {slowMovers.slice(0, 12).map(({ p, value }) => (
                <tr key={p.id}>
                  <Td className="font-semibold truncate max-w-[200px]">{p.reference}</Td>
                  <Td className="text-right tabular-nums">{Math.round(stockOf(p))}</Td>
                  <Td className="text-right tabular-nums">{fmtCurrency(p.cost_per_unit || 0)}</Td>
                  <Td className="text-right font-mono font-semibold text-amber-600">{fmtCurrency(value)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function SerialLookup() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<{
    serial: string;
    label: { reference: string; quantity: number; location: string | null; printed_at: string } | null;
    remision: { number: string; beneficiary: string | null; status: string } | null;
    scannedAt: string | null;
  } | null>(null);

  const search = async () => {
    const raw = input.trim();
    if (!raw) return;
    const parsed = parseScan(raw);
    const serial = (parsed?.serial || raw).trim();
    setLoading(true); setSearched(true);
    try {
      const { data: labels } = await (supabase as any).from('inventory_labels')
        .select('reference, quantity, location, printed_at').ilike('serial', serial).limit(1);
      const label = (labels && labels[0]) || null;
      const { data: scans } = await (supabase as any).from('dispatch_scans')
        .select('remision_id, scanned_at').eq('serial', serial).order('scanned_at', { ascending: true });
      let remision = null; let scannedAt: string | null = null;
      if (scans && scans.length) {
        scannedAt = scans[0].scanned_at;
        const { data: rem } = await (supabase.from('remisiones') as any)
          .select('number, beneficiary, status').eq('id', scans[0].remision_id).maybeSingle();
        remision = rem || null;
      }
      setResult({ serial, label, remision, scannedAt });
    } catch {
      setResult({ serial, label: null, remision: null, scannedAt: null });
    } finally { setLoading(false); }
  };

  const notFound = result && !result.label && !result.remision;

  return (
    <Card icon={<PackageSearch className="h-4 w-4 text-violet-600" />} title="Trazabilidad de bulto — buscar serial">
      <div className="px-2 pb-2 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
              placeholder="Escaneá o escribí el serial (ej: SA325B-0042)"
              className="pl-9"
            />
          </div>
          <button onClick={search} disabled={loading} className="h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
          </button>
        </div>

        {!searched && <p className="text-xs text-muted-foreground">Para una queja: escaneá el QR del bulto (o tipeá su serial) y ves su historia completa — qué es, dónde estaba y en qué remisión salió.</p>}

        {searched && !loading && result && (
          notFound ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              No encontramos el serial <strong className="font-mono">{result.serial}</strong>. Revisá que esté bien escrito (puede ser una etiqueta vieja, sin serial).
            </div>
          ) : (
            <div className="space-y-2">
              <div className="font-mono font-bold text-lg">{result.serial}</div>
              <div className="flex items-start gap-3 bg-slate-50 border rounded-xl p-3">
                <div className="h-8 w-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0"><Package className="h-4 w-4 text-slate-600" /></div>
                <div className="text-sm min-w-0">
                  <div className="font-semibold">{result.label ? 'Impreso / en bodega' : 'No registrado al imprimir'}</div>
                  {result.label && (
                    <div className="text-muted-foreground truncate">
                      {result.label.reference} · {Math.round(Number(result.label.quantity) || 0)} und · ubic. {result.label.location || '—'} · {fmtDateTime(result.label.printed_at)}
                    </div>
                  )}
                </div>
              </div>
              <div className={`flex items-start gap-3 border rounded-xl p-3 ${result.remision ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${result.remision ? 'bg-green-200' : 'bg-slate-100'}`}><Truck className={`h-4 w-4 ${result.remision ? 'text-green-700' : 'text-slate-400'}`} /></div>
                <div className="text-sm min-w-0">
                  {result.remision ? (
                    <>
                      <div className="font-semibold text-green-700">Despachado en {result.remision.number}</div>
                      <div className="text-muted-foreground truncate">Cliente: <strong className="text-foreground">{result.remision.beneficiary || '—'}</strong> · {fmtDateTime(result.scannedAt)}</div>
                    </>
                  ) : (
                    <div className="font-semibold text-muted-foreground">Todavía en bodega (sin despachar)</div>
                  )}
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </Card>
  );
}

function Card({ icon, title, right, children }: { icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-sm">{icon} {title}</div>
        {right}
      </div>
      <div className="p-1.5 sm:p-3">{children}</div>
    </div>
  );
}
function Avg({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-base font-extrabold tabular-nums leading-none inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-muted-foreground" />{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-muted-foreground">{head.map((h, i) => <th key={i} className={`font-semibold px-3 py-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground px-3 py-6 text-center">{children}</div>;
}
