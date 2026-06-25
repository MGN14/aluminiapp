import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { InventoryProduct } from '@/hooks/useInventoryData';
import { MapPin, Plus, Trash2, Search, ChevronDown, ChevronRight, Check, Loader2, Save } from 'lucide-react';

interface Props { products: InventoryProduct[]; }
interface BinRow { location: string; quantity: number; }
interface LocRow { product_id: string; location: string; quantity: number; }

export default function UbicacionesPanel({ products }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, BinRow[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: locs = [], refetch } = useQuery({
    queryKey: ['inventory-locations', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('inventory_locations').select('product_id, location, quantity');
      if (error) throw error;
      return (data || []) as LocRow[];
    },
    enabled: !!user?.id,
  });

  const binsByProduct = useMemo(() => {
    const m = new Map<string, BinRow[]>();
    for (const l of locs) {
      const arr = m.get(l.product_id) ?? [];
      arr.push({ location: l.location, quantity: Number(l.quantity) || 0 });
      m.set(l.product_id, arr);
    }
    return m;
  }, [locs]);

  const labelable = useMemo(
    () => products.filter(p => (Number(p.stock_physical) || 0) > 0).sort((a, b) => a.reference.localeCompare(b.reference, 'es', { numeric: true })),
    [products],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return labelable;
    return labelable.filter(p => (p.reference || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q));
  }, [labelable, search]);

  const binsOf = (p: InventoryProduct): BinRow[] => edited[p.id] ?? binsByProduct.get(p.id) ?? [];
  const setBins = (p: InventoryProduct, rows: BinRow[]) => setEdited(prev => ({ ...prev, [p.id]: rows }));
  const sumBins = (rows: BinRow[]) => rows.reduce((s, b) => s + (b.quantity || 0), 0);

  const toggle = (p: InventoryProduct) => {
    if (expanded === p.id) { setExpanded(null); return; }
    if (!edited[p.id]) {
      const cur = binsByProduct.get(p.id);
      setEdited(prev => ({ ...prev, [p.id]: cur && cur.length ? cur.map(b => ({ ...b })) : [{ location: '', quantity: Math.round(Number(p.stock_physical) || 0) }] }));
    }
    setExpanded(p.id);
  };

  const saveBins = async (p: InventoryProduct) => {
    const merged = new Map<string, number>();
    for (const r of binsOf(p)) {
      const loc = (r.location || '').trim().toUpperCase();
      if (!loc || !(r.quantity > 0)) continue;
      merged.set(loc, (merged.get(loc) || 0) + r.quantity);
    }
    setSavingId(p.id);
    try {
      const { error: delErr } = await (supabase as any).from('inventory_locations').delete().eq('product_id', p.id);
      if (delErr) throw delErr;
      const toInsert = Array.from(merged.entries()).map(([location, quantity]) => ({ user_id: user!.id, product_id: p.id, location, quantity }));
      if (toInsert.length) {
        const { error: insErr } = await (supabase as any).from('inventory_locations').insert(toInsert);
        if (insErr) throw insErr;
      }
      await refetch();
      setEdited(prev => { const n = { ...prev }; delete n[p.id]; return n; });
      toast({ title: `Ubicaciones de ${p.reference} guardadas` });
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  if (labelable.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-800">
        No hay referencias con inventario físico todavía. Contá primero en la pestaña <strong>“Conteo físico”</strong> y volvé acá a asignar las ubicaciones.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar referencia o descripción…" className="pl-9" />
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Asigná en qué bins (A1, C3…) está cada referencia y cuánto hay en cada uno. La suma debe cuadrar con el <strong>físico</strong>.
        Esto alimenta el <strong>picking dirigido</strong> paso a paso del despacho.
      </p>

      <div className="space-y-2.5">
        {filtered.map(p => {
          const isOpen = expanded === p.id;
          const bins = binsOf(p);
          const phys = Math.round(Number(p.stock_physical) || 0);
          const sum = sumBins(bins);
          const remaining = phys - sum;
          const savedBins = binsByProduct.get(p.id) ?? [];
          const binsCount = bins.filter(b => (b.location || '').trim() && (b.quantity || 0) > 0).length;
          const summary = savedBins.length ? savedBins.map(b => `${b.location} ${b.quantity}`).join(' · ') : 'sin ubicar';

          return (
            <div key={p.id} className="bg-white border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3">
                <button onClick={() => toggle(p)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">{p.reference}</span>
                      {p.system && <span className="text-[10px] font-bold uppercase tracking-wide bg-slate-900 text-white px-1.5 py-0.5 rounded">{p.system}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{p.name || 'Sin descripción'} · <span className="font-medium text-foreground">{summary}</span></div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-lg font-extrabold tabular-nums leading-none">{phys} <span className="text-xs font-medium text-muted-foreground">físicas</span></div>
                    <div className="text-[11px] text-muted-foreground">{sum} ubicadas</div>
                  </div>
                </button>
                <CoverageBadge remaining={remaining} bins={binsCount} />
              </div>

              {isOpen && (
                <div className="border-t px-4 py-3 bg-slate-50/60 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Ubicaciones (bins) y cantidad</div>
                  <div className="space-y-2">
                    {bins.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white border rounded-xl px-3 py-2">
                        <Input value={b.location} onChange={e => setBins(p, bins.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} placeholder="A1" className="h-9 w-24 text-center font-mono font-bold uppercase" aria-label="Ubicación" />
                        <span className="text-sm text-muted-foreground">→</span>
                        <Input type="number" min={0} value={b.quantity || ''} onChange={e => setBins(p, bins.map((x, j) => j === i ? { ...x, quantity: +e.target.value } : x))} className="h-9 w-24 text-center font-mono" aria-label="Cantidad" />
                        <span className="text-sm text-muted-foreground">und</span>
                        <button onClick={() => setBins(p, bins.filter((_, j) => j !== i))} className="ml-auto text-muted-foreground hover:text-red-500" aria-label="Quitar bin"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                    <button onClick={() => setBins(p, [...bins, { location: '', quantity: remaining > 0 ? remaining : 0 }])} className="h-9 px-3 rounded-xl border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-white">
                      <Plus className="h-4 w-4" /> Agregar bin
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Ubicado: </span>
                      <span className={`font-bold tabular-nums ${remaining === 0 ? 'text-emerald-600' : remaining > 0 ? 'text-amber-600' : 'text-red-600'}`}>{sum}/{phys}</span>
                      {remaining > 0 && <span className="text-amber-600 font-semibold"> · faltan {remaining}</span>}
                      {remaining < 0 && <span className="text-red-600 font-semibold"> · sobran {-remaining}</span>}
                      {remaining === 0 && <Check className="h-4 w-4 text-emerald-600 inline ml-1 -mt-0.5" />}
                    </div>
                    <button onClick={() => saveBins(p)} disabled={savingId === p.id} className="h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 hover:opacity-90">
                      {savingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-sm text-muted-foreground py-10 border border-dashed rounded-2xl bg-white">Sin coincidencias.</div>}
      </div>
    </div>
  );
}

function CoverageBadge({ remaining, bins }: { remaining: number; bins: number }) {
  if (bins === 0) return <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-500 flex-shrink-0">Sin ubicar</span>;
  if (remaining === 0) return <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 flex-shrink-0 inline-flex items-center gap-1"><Check className="h-3 w-3" /> {bins} bin{bins === 1 ? '' : 's'}</span>;
  const cls = remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-[11px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${cls}`}>{remaining > 0 ? `faltan ${remaining}` : `sobran ${-remaining}`}</span>;
}
