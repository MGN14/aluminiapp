import { useState, useEffect, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { InventoryProduct } from '@/hooks/useInventoryData';
import { encodeLabelPayload, normalizeRef } from '@/lib/qrLabel';
import { printQrLabels, type LabelRow } from '@/lib/printQrLabels';
import {
  Printer, Plus, Trash2, Search, ChevronDown, ChevronRight, Check, AlertTriangle, Layers, MapPin,
  RotateCcw, Ban, Loader2,
} from 'lucide-react';

interface Props {
  products: InventoryProduct[];
  onSaved?: () => void;
}

interface PackageGroup { count: number; size: number; }

const STORAGE_KEY = 'etiquetas:packaging:v1';

// Sugerencia automática del desglose en paquetes: tantos paquetes "estándar"
// (units_per_package) como entren en el físico, más un paquete con el resto.
// Ej: físico 210, estándar 40 → [5×40, 1×10]. Es lo que Nico pidió.
function seedGroups(physical: number, upp: number): PackageGroup[] {
  const phys = Math.max(0, Math.round(physical));
  if (phys <= 0) return [];
  const size = upp > 0 ? Math.round(upp) : phys;
  if (size >= phys) return [{ count: 1, size: phys }];
  const full = Math.floor(phys / size);
  const rem = phys - full * size;
  const groups: PackageGroup[] = [{ count: full, size }];
  if (rem > 0) groups.push({ count: 1, size: rem });
  return groups;
}

const allocated = (gs: PackageGroup[]) => gs.reduce((s, g) => s + (g.count || 0) * (g.size || 0), 0);
const labelCount = (gs: PackageGroup[]) => gs.reduce((s, g) => s + (g.count || 0), 0);

export default function QrLabelsPanel({ products, onSaved }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [packaging, setPackaging] = useState<Record<string, PackageGroup[]>>({});
  const [locationOverride, setLocationOverride] = useState<Record<string, string>>({});
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPackaging(JSON.parse(raw) || {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(packaging)); } catch { /* ignore */ }
  }, [packaging]);

  // Solo lo que tiene inventario FÍSICO cargado (>0) — es lo que está en bodega
  // y se va a escanear.
  const labelable = useMemo(
    () => products
      .filter(p => (Number(p.stock_physical) || 0) > 0)
      .sort((a, b) => a.reference.localeCompare(b.reference, 'es', { numeric: true })),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return labelable;
    return labelable.filter(p =>
      (p.reference || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q));
  }, [labelable, search]);

  // Grupos efectivos de una referencia: lo que la encargada editó, o la
  // sugerencia automática si todavía no la tocó.
  const groupsOf = useCallback((p: InventoryProduct): PackageGroup[] => {
    const k = normalizeRef(p.reference);
    return packaging[k] ?? seedGroups(Number(p.stock_physical) || 0, Number(p.units_per_package) || 0);
  }, [packaging]);

  const setGroups = (p: InventoryProduct, gs: PackageGroup[]) =>
    setPackaging(prev => ({ ...prev, [normalizeRef(p.reference)]: gs }));

  // Ubicación efectiva (lo editado localmente, o lo guardado en el producto).
  const locOf = (p: InventoryProduct): string => {
    const k = normalizeRef(p.reference);
    return locationOverride[k] !== undefined ? locationOverride[k] : (p.location ?? '');
  };

  const persistLocation = async (p: InventoryProduct) => {
    const k = normalizeRef(p.reference);
    if (locationOverride[k] === undefined) return; // no se tocó
    const val = locationOverride[k].trim().toUpperCase();
    if (val === (p.location ?? '').trim().toUpperCase()) return; // sin cambio real
    try {
      await supabase.from('inventory_products').update({ location: val || null } as never).eq('id', p.id);
      onSaved?.();
    } catch (e: any) {
      toast({ title: 'No se pudo guardar la ubicación', description: e.message, variant: 'destructive' });
    }
  };

  const toggleExpand = (p: InventoryProduct) => {
    const k = normalizeRef(p.reference);
    if (expanded === k) { setExpanded(null); return; }
    // Al abrir por primera vez, materializamos la sugerencia para poder editarla.
    if (!packaging[k]) {
      setPackaging(prev => ({ ...prev, [k]: seedGroups(Number(p.stock_physical) || 0, Number(p.units_per_package) || 0) }));
    }
    setExpanded(k);
  };

  const totalLabelsAll = useMemo(
    () => labelable.reduce((s, p) => s + labelCount(groupsOf(p)), 0),
    [labelable, groupsOf],
  );

  // Tamaño de paquete "estándar" para guardar como units_per_package: el del
  // grupo con más paquetes (el dominante).
  const dominantSize = (gs: PackageGroup[]): number => {
    let best = 0, bestCount = -1;
    for (const g of gs) if ((g.count || 0) > bestCount) { bestCount = g.count || 0; best = g.size || 0; }
    return best;
  };

  const persistUpp = async (entries: { id: string; size: number }[]) => {
    const valid = entries.filter(e => e.size > 0);
    if (valid.length === 0) return;
    await Promise.all(valid.map(e =>
      supabase.from('inventory_products').update({ units_per_package: e.size } as never).eq('id', e.id)));
    onSaved?.();
  };

  // Genera las filas de etiquetas YA serializadas: reserva N serials (uno por
  // etiqueta) y arma una fila por etiqueta con su serial único (LPN). Si la
  // reserva de serials falla, imprime igual sin serial (no rompe el flujo),
  // pero AVISA: sin serial no hay anti-doble-escaneo ni trazabilidad por bulto.
  const buildSerializedRows = async (p: InventoryProduct): Promise<LabelRow[]> => {
    const groups = groupsOf(p).filter(g => (g.count || 0) > 0 && (g.size || 0) > 0);
    const total = groups.reduce((s, g) => s + g.count, 0);
    if (total === 0) return [];
    let serials: (string | undefined)[] = new Array(total).fill(undefined);
    try {
      const { data, error } = await (supabase.rpc as any)('allocate_label_seq', { p_product_id: p.id, p_count: total });
      if (error) throw error;
      if (Number.isFinite(Number(data))) {
        const start = Number(data) - total + 1;
        serials = Array.from({ length: total }, (_, i) => `${p.reference}-${String(start + i).padStart(4, '0')}`);
      }
    } catch {
      toast({
        title: `${p.reference}: etiquetas SIN serial`,
        description: 'No se pudieron reservar los serials (¿conexión?). Se imprimen igual, pero sin anti-doble-escaneo ni trazabilidad por bulto.',
        variant: 'destructive',
      });
    }
    const rows: LabelRow[] = [];
    let si = 0;
    for (const g of groups) {
      for (let c = 0; c < g.count; c++) {
        rows.push({ reference: p.reference, name: p.name, system: p.system ?? null, quantity: g.size, copies: 1, location: locOf(p), serial: serials[si++] });
      }
    }
    // Registrar las etiquetas impresas (trazabilidad por bulto = la "entrada").
    const labelRows = rows.filter(r => r.serial).map(r => ({
      user_id: user?.id ?? null, product_id: p.id, reference: r.reference,
      serial: r.serial, quantity: r.quantity, location: r.location || null, printed_by: user?.id ?? null,
    }));
    if (labelRows.length) {
      try {
        const { error } = await (supabase as any).from('inventory_labels').insert(labelRows);
        if (error) throw error;
      } catch {
        toast({
          title: `${p.reference}: etiquetas sin registrar`,
          description: 'Se imprimen igual, pero no quedaron en el historial de etiquetas (no vas a poder reimprimirlas por serial).',
        });
      }
    }
    return rows;
  };

  const printOne = async (p: InventoryProduct) => {
    const groups = groupsOf(p);
    const labels = labelCount(groups);
    if (labels === 0) { toast({ title: 'Definí al menos un paquete', variant: 'destructive' }); return; }
    // El etiquetado debe cuadrar con el físico contado (físico vs etiquetado).
    const phys = Math.round(Number(p.stock_physical) || 0);
    const alloc = allocated(groups);
    if (alloc !== phys && !window.confirm(`Estás etiquetando ${alloc} unidades pero el físico contado de ${p.reference} es ${phys}. Deberían coincidir. ¿Imprimir igual?`)) return;
    setPrinting(true);
    try {
      const rows = await buildSerializedRows(p);
      await printQrLabels(rows);
      await persistUpp([{ id: p.id, size: dominantSize(groups) }]);
    } catch (e: any) {
      toast({ title: 'No se pudo imprimir', description: e.message, variant: 'destructive' });
    } finally { setPrinting(false); }
  };

  const printAll = async () => {
    if (totalLabelsAll === 0) { toast({ title: 'No hay paquetes para imprimir', variant: 'destructive' }); return; }
    if (!window.confirm(`Vas a imprimir ${totalLabelsAll} etiquetas. ¿Continuar?`)) return;
    setPrinting(true);
    try {
      const rows: LabelRow[] = [];
      const upp: { id: string; size: number }[] = [];
      for (const p of labelable) {
        const r = await buildSerializedRows(p);
        if (r.length > 0) { rows.push(...r); upp.push({ id: p.id, size: dominantSize(groupsOf(p)) }); }
      }
      if (rows.length === 0) { setPrinting(false); return; }
      await printQrLabels(rows);
      await persistUpp(upp);
    } catch (e: any) {
      toast({ title: 'No se pudo imprimir', description: e.message, variant: 'destructive' });
    } finally { setPrinting(false); }
  };

  if (labelable.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-800 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Todavía no hay inventario físico cargado.</p>
          <p className="mt-1">Las etiquetas se generan desde lo que hay en bodega. Andá a la pestaña <strong>“Conteo físico”</strong>, contá (o subí el conteo), y volvé acá: cada referencia con físico mayor a 0 aparecerá lista para empaquetar e imprimir.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra superior: buscar + imprimir todo */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar referencia o descripción…"
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {labelable.length} referencias · <strong className="text-foreground tabular-nums">{totalLabelsAll}</strong> etiquetas
        </span>
        <button
          onClick={printAll}
          disabled={printing || totalLabelsAll === 0}
          className="h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40 hover:opacity-90"
        >
          <Printer className="h-4 w-4" /> Imprimir todo
        </button>
      </div>

      <p className="text-xs text-muted-foreground -mt-1">
        Etiquetá exactamente lo que contaste: cada referencia compara <strong>físico contado vs etiquetado</strong>.
        El desglose en paquetes debe sumar el físico. (El comparativo vs Siigo está en el módulo de Inventarios.)
      </p>

      {/* Lista de referencias físicas */}
      <div className="space-y-2.5">
        {filtered.map(p => {
          const k = normalizeRef(p.reference);
          const isOpen = expanded === k;
          const groups = groupsOf(p);
          const phys = Math.round(Number(p.stock_physical) || 0);
          const alloc = allocated(groups);
          const remaining = phys - alloc;
          const labels = labelCount(groups);

          return (
            <div key={k} className="bg-white border rounded-2xl overflow-hidden">
              {/* Header de la referencia */}
              <div className="px-4 py-3 flex items-center gap-3">
                <button onClick={() => toggleExpand(p)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">{p.reference}</span>
                      {p.system && <span className="text-[10px] font-bold uppercase tracking-wide bg-slate-900 text-white px-1.5 py-0.5 rounded">{p.system}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{p.name || 'Sin descripción'}</div>
                  </div>
                  {/* Físico contado vs etiquetado (el comparativo vs Siigo vive en Inventarios) */}
                  <div className="text-right hidden sm:block">
                    <div className="text-lg font-extrabold tabular-nums leading-none">{phys} <span className="text-xs font-medium text-muted-foreground">físicas</span></div>
                    <div className="text-[11px] text-muted-foreground">{alloc} etiquetadas</div>
                  </div>
                  <CoverageBadge remaining={remaining} labels={labels} />
                </button>
                {/* Ubicación editable — va en el QR y se imprime en la etiqueta */}
                <div className="flex items-center gap-1 flex-shrink-0" title="Ubicación en bodega (ej: A1). Va dentro del QR y en la etiqueta.">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={locOf(p)}
                    onChange={e => setLocationOverride(prev => ({ ...prev, [k]: e.target.value }))}
                    onBlur={() => persistLocation(p)}
                    placeholder="Ubic."
                    className="h-9 w-16 text-center text-sm font-mono font-bold uppercase border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                    aria-label={`Ubicación de ${p.reference}`}
                  />
                </div>
              </div>

              {/* Editor de empaquetado */}
              {isOpen && (
                <div className="border-t px-4 py-3 bg-slate-50/60 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" /> Empaquetado · cada paquete = 1 etiqueta QR con su cantidad
                  </div>

                  <div className="space-y-2">
                    {groups.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white border rounded-xl px-3 py-2">
                        <Input
                          type="number" min={1} value={g.count || ''}
                          onChange={e => setGroups(p, groups.map((x, j) => j === i ? { ...x, count: +e.target.value } : x))}
                          className="h-9 w-16 text-center font-mono" aria-label="Cantidad de paquetes"
                        />
                        <span className="text-sm text-muted-foreground">paq. de</span>
                        <Input
                          type="number" min={1} value={g.size || ''}
                          onChange={e => setGroups(p, groups.map((x, j) => j === i ? { ...x, size: +e.target.value } : x))}
                          className="h-9 w-20 text-center font-mono" aria-label="Unidades por paquete"
                        />
                        <span className="text-sm text-muted-foreground">und</span>
                        <span className="text-sm font-semibold tabular-nums ml-1">= {(g.count || 0) * (g.size || 0)}</span>
                        <QrThumb reference={p.reference} size={g.size || 0} location={locOf(p)} />
                        <button
                          onClick={() => setGroups(p, groups.filter((_, j) => j !== i))}
                          className="ml-auto text-muted-foreground hover:text-red-500" aria-label="Quitar paquete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setGroups(p, [...groups, { count: 1, size: remaining > 0 ? remaining : (Number(p.units_per_package) || 1) }])}
                        className="h-9 px-3 rounded-xl border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-white"
                      >
                        <Plus className="h-4 w-4" /> Agregar paquete
                      </button>
                      <button
                        onClick={() => setGroups(p, seedGroups(phys, Number(p.units_per_package) || dominantSize(groups) || 0))}
                        className="h-9 px-3 rounded-xl border text-sm font-medium text-muted-foreground hover:bg-white"
                        title="Volver a la sugerencia automática según el físico"
                      >
                        Auto
                      </button>
                    </div>
                  </div>

                  {/* Resumen + imprimir */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Etiquetado: </span>
                      <span className={`font-bold tabular-nums ${remaining === 0 ? 'text-emerald-600' : remaining > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                        {alloc}/{phys}
                      </span>
                      <span className="text-muted-foreground"> físicas</span>
                      {remaining > 0 && <span className="text-amber-600 font-semibold"> · faltan {remaining}</span>}
                      {remaining < 0 && <span className="text-red-600 font-semibold"> · sobran {-remaining}</span>}
                      {remaining === 0 && <Check className="h-4 w-4 text-emerald-600 inline ml-1 -mt-0.5" />}
                      <span className="text-muted-foreground"> · {labels} etiqueta{labels === 1 ? '' : 's'}</span>
                    </div>
                    <button
                      onClick={() => printOne(p)}
                      disabled={printing || labels === 0}
                      className="h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40 hover:opacity-90"
                    >
                      <Printer className="h-4 w-4" /> Imprimir {labels}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-10 border border-dashed rounded-2xl bg-white">
            Ninguna referencia coincide con “{search}”.
          </div>
        )}
      </div>

      <ReprintSection products={products} />
    </div>
  );
}

// ─────────────── Reimprimir / anular etiquetas ya impresas ───────────────
// Etiqueta dañada o ilegible: se reimprime con el MISMO serial (el bulto sigue
// siendo el mismo — el anti-doble-escaneo por serial sigue valiendo). Si el
// bulto ya no existe, la etiqueta se anula para que no ensucie la trazabilidad.

interface PrintedLabel {
  id: string; reference: string; serial: string; quantity: number;
  location: string | null; status: string; printed_at: string;
}

function ReprintSection({ products }: { products: InventoryProduct[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PrintedLabel[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const byRef = useMemo(() => {
    const m = new Map<string, InventoryProduct>();
    for (const p of products) { const k = normalizeRef(p.reference); if (k) m.set(k, p); }
    return m;
  }, [products]);

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const term = q.trim().replace(/[(),]/g, ' ').trim();
    if (!term) { setRows(null); return; }
    setSearching(true);
    try {
      const { data, error } = await (supabase as any)
        .from('inventory_labels')
        .select('id, reference, serial, quantity, location, status, printed_at')
        .or(`serial.ilike.%${term}%,reference.ilike.%${term}%`)
        .order('printed_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setRows((data || []) as PrintedLabel[]);
    } catch (err: any) {
      toast({ title: 'No se pudo buscar etiquetas', description: err.message, variant: 'destructive' });
    } finally { setSearching(false); }
  };

  const reprint = async (r: PrintedLabel) => {
    setBusyId(r.id);
    try {
      const p = byRef.get(normalizeRef(r.reference));
      await printQrLabels([{
        reference: r.reference, name: p?.name || '', system: p?.system ?? null,
        quantity: Number(r.quantity) || 1, copies: 1, location: r.location, serial: r.serial,
      }]);
    } catch (err: any) {
      toast({ title: 'No se pudo reimprimir', description: err.message, variant: 'destructive' });
    } finally { setBusyId(null); }
  };

  const toggleAnulada = async (r: PrintedLabel) => {
    const next = r.status === 'anulada' ? 'en_bodega' : 'anulada';
    setBusyId(r.id);
    try {
      const { error } = await (supabase as any).from('inventory_labels').update({ status: next }).eq('id', r.id);
      if (error) throw error;
      setRows(prev => prev ? prev.map(x => x.id === r.id ? { ...x, status: next } : x) : prev);
    } catch (err: any) {
      toast({ title: 'No se pudo actualizar la etiqueta', description: err.message, variant: 'destructive' });
    } finally { setBusyId(null); }
  };

  return (
    <div className="bg-white border rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <RotateCcw className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-sm">Reimprimir / anular etiquetas impresas</div>
          <div className="text-xs text-muted-foreground">¿Etiqueta dañada? Buscala por serial o referencia y reimprimila con el mismo serial.</div>
        </div>
      </button>
      {open && (
        <div className="border-t px-4 py-3 bg-slate-50/60 space-y-3">
          <form onSubmit={runSearch} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Serial (ej: SA325B-0042) o referencia…" className="pl-9 bg-white" />
            </div>
            <button type="submit" disabled={searching} className="h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
            </button>
          </form>

          {rows !== null && rows.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-6">Ninguna etiqueta impresa coincide con “{q}”.</div>
          )}
          {rows && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.id} className={`bg-white rounded-xl border px-3 py-2 flex items-center gap-3 ${r.status === 'anulada' ? 'opacity-60' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-bold text-sm truncate">{r.serial}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.reference} · x{Number(r.quantity) || 0} und{r.location ? ` · ${r.location}` : ''} · {new Date(r.printed_at).toLocaleDateString('es-CO')}
                      {r.status === 'anulada' && <span className="text-red-600 font-semibold"> · ANULADA</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => reprint(r)}
                    disabled={busyId === r.id || r.status === 'anulada'}
                    className="h-9 px-3 rounded-lg border bg-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-40"
                    title="Reimprimir esta etiqueta con el mismo serial"
                  >
                    <Printer className="h-3.5 w-3.5" /> Reimprimir
                  </button>
                  <button
                    onClick={() => toggleAnulada(r)}
                    disabled={busyId === r.id}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 ${r.status === 'anulada' ? 'bg-white hover:bg-slate-50' : 'bg-white text-red-600 hover:bg-red-50'}`}
                    title={r.status === 'anulada' ? 'Volver a marcar como en bodega' : 'Anular (el bulto ya no existe)'}
                  >
                    {r.status === 'anulada' ? <><RotateCcw className="h-3.5 w-3.5" /> Reactivar</> : <><Ban className="h-3.5 w-3.5" /> Anular</>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CoverageBadge({ remaining, labels }: { remaining: number; labels: number }) {
  if (labels === 0) {
    return <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-500 flex-shrink-0">Sin empaquetar</span>;
  }
  if (remaining === 0) {
    return <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 flex-shrink-0 inline-flex items-center gap-1"><Check className="h-3 w-3" /> {labels} QR</span>;
  }
  const cls = remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-[11px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${cls}`}>{remaining > 0 ? `faltan ${remaining}` : `sobran ${-remaining}`}</span>;
}

// Miniatura del QR específico de un paquete (referencia + cantidad + ubicación).
function QrThumb({ reference, size, location }: { reference: string; size: number; location?: string }) {
  const [svg, setSvg] = useState('');
  const payload = encodeLabelPayload(reference, size > 0 ? size : 1, location);
  useEffect(() => {
    let active = true;
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })
      .then(s => { if (active) setSvg(s); })
      .catch(() => { if (active) setSvg(''); });
    return () => { active = false; };
  }, [payload]);
  return (
    <div
      className="h-9 w-9 border rounded p-0.5 bg-white flex-shrink-0 [&>svg]:h-full [&>svg]:w-full"
      title={`QR: ${payload}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
