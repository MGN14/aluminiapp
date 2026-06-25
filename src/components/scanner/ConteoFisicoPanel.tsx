import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, normalizeRef } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { supabase } from '@/integrations/supabase/client';
import type { InventoryProduct } from '@/hooks/useInventoryData';
import {
  ScanLine, Check, Plus, Minus, Trash2, AlertTriangle, Loader2, Save, Eraser, RadioTower, Undo2, User,
} from 'lucide-react';

interface Props { products: InventoryProduct[]; }
interface CountEntry { reference: string; quantity: number; }

const STORAGE_KEY = 'conteo:session:v1';

export default function ConteoFisicoPanel({ products }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  const productByRef = useMemo(() => {
    const m = new Map<string, InventoryProduct>();
    for (const p of products) {
      const k = normalizeRef(p.reference);
      if (k) m.set(k, p);
    }
    return m;
  }, [products]);

  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'warn'; text: string; sub?: string } | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualRef, setManualRef] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<{ key: string; qty: number } | null>(null);
  const flashTimer = useRef<number | null>(null);
  const lastKeyTimer = useRef<number | null>(null);
  const sessionStartRef = useRef<string | null>(null); // inicio del conteo (para "tiempo de inventario")

  // Restaurar / persistir la sesión (sobrevive refresh o bloqueo de la tablet).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        setCounts(o.counts || {});
        setOrder(o.order || Object.keys(o.counts || {}));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ counts, order })); } catch { /* ignore */ }
  }, [counts, order]);

  const flashMsg = useCallback((kind: 'ok' | 'warn', text: string, sub?: string) => {
    setFlash({ kind, text, sub });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  }, []);

  const addCount = useCallback((rawRef: string, qty: number) => {
    const key = normalizeRef(rawRef);
    if (!key) return;
    if (!sessionStartRef.current) sessionStartRef.current = new Date().toISOString();
    const prod = productByRef.get(key);
    const displayRef = prod?.reference ?? rawRef.trim();
    setCounts(prev => {
      const cur = prev[key];
      return { ...prev, [key]: { reference: displayRef, quantity: (cur?.quantity || 0) + qty } };
    });
    // Orden ESTABLE: una ref nueva aparece arriba; re-escanearla NO la mueve
    // (antes saltaba al tope en cada lectura — se sentía inestable).
    setOrder(prev => prev.includes(key) ? prev : [key, ...prev]);
    // Resaltar la fila recién escaneada ~1.2s para que el update en vivo se vea.
    setLastKey(key);
    setLastScan({ key, qty });
    if (lastKeyTimer.current) window.clearTimeout(lastKeyTimer.current);
    lastKeyTimer.current = window.setTimeout(() => setLastKey(null), 1200);
    if (prod) { flashMsg('ok', `${displayRef}  +${qty}`, prod.name); beep('ok'); }
    else { flashMsg('warn', displayRef, 'Sin match en inventario — no se guardará'); beep('warn'); }
  }, [productByRef, flashMsg]);

  // Deshacer el último escaneo (resta exactamente la cantidad que sumó).
  const undoLast = () => {
    if (!lastScan) return;
    const { key, qty } = lastScan;
    const cur = counts[key]?.quantity || 0;
    const nv = Math.max(0, cur - qty);
    setCounts(prev => {
      const n = { ...prev };
      if (nv === 0) delete n[key]; else n[key] = { ...n[key], quantity: nv };
      return n;
    });
    if (nv === 0) setOrder(prev => prev.filter(k => k !== key));
    setLastScan(null);
    flashMsg('warn', 'Último escaneo deshecho', `${lastScan.key} −${qty}`);
    beep('warn');
  };

  const handleScan = useCallback((raw: string) => {
    const parsed = parseScan(raw);
    if (!parsed) { flashMsg('warn', 'Código ilegible'); beep('warn'); return; }
    addCount(parsed.reference, parsed.quantity);
  }, [addCount, flashMsg]);

  useScannerGun({ onScan: handleScan, enabled: !showReview });

  const adjust = (key: string, delta: number) =>
    setCounts(prev => {
      const cur = prev[key];
      if (!cur) return prev;
      return { ...prev, [key]: { ...cur, quantity: Math.max(0, cur.quantity + delta) } };
    });

  const removeKey = (key: string) => {
    setCounts(prev => { const n = { ...prev }; delete n[key]; return n; });
    setOrder(prev => prev.filter(k => k !== key));
  };

  const clearAll = () => {
    if (order.length > 0 && !window.confirm('¿Vaciar el conteo actual? Se pierde lo escaneado.')) return;
    setCounts({}); setOrder([]);
    sessionStartRef.current = null;
  };

  const distinctRefs = order.length;
  const totalUnits = useMemo(() => Object.values(counts).reduce((s, c) => s + c.quantity, 0), [counts]);
  const matchedKeys = useMemo(() => order.filter(k => productByRef.has(k)), [order, productByRef]);
  const unmatchedCount = order.length - matchedKeys.length;

  const reviewRows = useMemo(() =>
    matchedKeys.map(k => {
      const prod = productByRef.get(k)!;
      const counted = counts[k]?.quantity || 0;
      const system = Number(prod.stock_system) || 0;
      return { id: prod.id, reference: prod.reference, name: prod.name, counted, system, diff: system - counted };
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
    [matchedKeys, counts, productByRef]);

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualRef.trim() || manualQty <= 0) return;
    addCount(manualRef, manualQty);
    setManualRef('');
    setManualQty(1);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const confirmCount = async () => {
    if (reviewRows.length === 0) {
      toast({ title: 'No hay referencias con match para guardar', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const nowIso = new Date().toISOString();
    try {
      const chunkSize = 20;
      for (let i = 0; i < reviewRows.length; i += chunkSize) {
        const chunk = reviewRows.slice(i, i + chunkSize);
        const results = await Promise.all(
          chunk.map(r =>
            supabase.from('inventory_products')
              .update({ stock_physical: r.counted, last_count_date: nowIso })
              .eq('id', r.id),
          ),
        );
        const failed = results.find(res => res.error);
        if (failed?.error) throw failed.error;
      }
      // Registrar la sesión de conteo (tiempo de inventario + productividad).
      try {
        await (supabase as any).from('count_sessions').insert({
          user_id: user?.id ?? null,
          operator_id: user?.id ?? null,
          started_at: sessionStartRef.current,
          ended_at: nowIso,
          refs_count: reviewRows.length,
          units_count: reviewRows.reduce((s, r) => s + r.counted, 0),
          diffs_count: reviewRows.filter(r => r.diff !== 0).length,
        });
      } catch { /* no crítico para el conteo */ }
      sessionStartRef.current = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      setCounts({}); setOrder([]); setShowReview(false);
      toast({
        title: 'Conteo guardado',
        description: `${reviewRows.length} referencia${reviewRows.length === 1 ? '' : 's'} actualizada${reviewRows.length === 1 ? '' : 's'} con el conteo físico.`,
      });
    } catch (e: any) {
      toast({ title: 'No se pudo guardar el conteo', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const accent = flash?.kind === 'ok' ? 'green' : flash?.kind === 'warn' ? 'red' : 'idle';

  return (
    <div className="space-y-5">
      {/* Tarjeta de escaneo — el foco visual del módulo */}
      <div
        className={`rounded-2xl border-2 bg-white px-5 py-5 flex items-center gap-4 transition-colors ${
          accent === 'green' ? 'border-emerald-400 bg-emerald-50/40'
          : accent === 'red' ? 'border-red-300 bg-red-50/40'
          : 'border-dashed border-slate-300'
        }`}
      >
        <div className={`h-14 w-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
          accent === 'green' ? 'bg-emerald-500 text-white'
          : accent === 'red' ? 'bg-red-500 text-white'
          : 'bg-slate-100 text-slate-400'
        }`}>
          {accent === 'green' ? <Check className="h-7 w-7" />
            : accent === 'red' ? <AlertTriangle className="h-7 w-7" />
            : <RadioTower className="h-7 w-7 animate-pulse" />}
        </div>
        <div className="min-w-0 flex-1">
          {flash ? (
            <>
              <div className="text-xl font-extrabold truncate leading-tight">{flash.text}</div>
              {flash.sub && <div className="text-sm text-muted-foreground truncate">{flash.sub}</div>}
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-slate-700">Listo para escanear</div>
              <div className="text-sm text-muted-foreground">Dispará la pistola sobre el QR de cada paquete</div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {lastScan && (
            <button onClick={undoLast} className="h-9 px-3 rounded-xl border bg-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-slate-50">
              <Undo2 className="h-4 w-4" /> Deshacer
            </button>
          )}
          <ScanLine className="h-6 w-6 text-slate-300 hidden sm:block" />
        </div>
      </div>

      {user?.email && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground -mt-2">
          <User className="h-3.5 w-3.5" /> Operario: <span className="font-medium text-foreground">{user.email}</span>
        </div>
      )}

      {/* Stats + acciones */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatChip label="Referencias" value={distinctRefs} />
        <StatChip label="Unidades" value={totalUnits} />
        <StatChip label="Sin match" value={unmatchedCount} warn={unmatchedCount > 0} />
        <div className="flex-1" />
        {order.length > 0 && (
          <button
            onClick={clearAll}
            className="h-10 px-3.5 rounded-xl border text-sm font-medium text-muted-foreground hover:bg-slate-50 inline-flex items-center gap-1.5"
          >
            <Eraser className="h-4 w-4" /> Vaciar
          </button>
        )}
        <button
          onClick={() => setShowReview(true)}
          disabled={matchedKeys.length === 0}
          className="h-10 px-5 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40 hover:opacity-90"
        >
          <Save className="h-4 w-4" /> Cerrar conteo{matchedKeys.length > 0 ? ` (${matchedKeys.length})` : ''}
        </button>
      </div>

      {/* Carga manual */}
      <form onSubmit={handleManualAdd} className="flex items-end gap-2 bg-white border rounded-2xl p-3">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground">¿Falta etiqueta? Cargar manual</label>
          <Input
            value={manualRef}
            onChange={e => setManualRef(e.target.value)}
            placeholder="Referencia…"
            list="conteo-refs"
            className="mt-1"
          />
          <datalist id="conteo-refs">
            {products.map(p => <option key={p.id} value={p.reference}>{p.name}</option>)}
          </datalist>
        </div>
        <div className="w-24">
          <label className="text-xs font-medium text-muted-foreground">Cant.</label>
          <Input type="number" min={1} value={manualQty || ''} onChange={e => setManualQty(+e.target.value)} className="mt-1 text-center font-mono" />
        </div>
        <button type="submit" className="h-10 px-4 rounded-xl border font-semibold text-sm inline-flex items-center gap-1 hover:bg-slate-50">
          <Plus className="h-4 w-4" /> Sumar
        </button>
      </form>

      {/* Lista de conteo */}
      {order.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-14 border border-dashed rounded-2xl bg-white">
          Escaneá el primer paquete para empezar el conteo.
        </div>
      ) : (
        <div className="space-y-2">
          {order.map(key => {
            const c = counts[key];
            if (!c) return null;
            const prod = productByRef.get(key);
            return (
              <div key={key} className={`bg-white rounded-2xl border p-3.5 flex items-center gap-3 transition-shadow ${!prod ? 'border-amber-300 bg-amber-50/40' : ''} ${key === lastKey ? (prod ? 'ring-2 ring-offset-1 ring-emerald-400' : 'ring-2 ring-offset-1 ring-amber-400') : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-base truncate">{c.reference}</div>
                  <div className={`text-xs truncate ${prod ? 'text-muted-foreground' : 'text-amber-700 font-medium'}`}>
                    {prod ? prod.name : 'No está en el inventario — no se guardará'}
                  </div>
                </div>
                <div className="text-2xl font-extrabold tabular-nums text-slate-800 leading-none">{c.quantity}</div>
                <div className="flex items-center gap-1.5">
                  <IconBtn onClick={() => adjust(key, -1)} label="Restar uno"><Minus className="h-4 w-4" /></IconBtn>
                  <IconBtn onClick={() => adjust(key, +1)} label="Sumar uno"><Plus className="h-4 w-4" /></IconBtn>
                  <IconBtn onClick={() => removeKey(key)} label="Quitar" danger><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Revisión / confirmación */}
      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Revisar conteo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            Se actualizará el <strong>stock físico</strong> de {reviewRows.length} referencia{reviewRows.length === 1 ? '' : 's'}.
            {unmatchedCount > 0 && <span className="text-amber-600"> {unmatchedCount} sin match se ignoran.</span>}
          </p>
          <div className="max-h-[55vh] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold px-4 py-2">Referencia</th>
                  <th className="text-right font-semibold px-3 py-2">Contado</th>
                  <th className="text-right font-semibold px-3 py-2">Sistema</th>
                  <th className="text-right font-semibold px-4 py-2">Dif.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reviewRows.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 min-w-0">
                      <div className="font-medium truncate">{r.reference}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.name}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.counted}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.system}</td>
                    <td className={`px-4 py-2 text-right font-mono tabular-nums font-semibold ${r.diff === 0 ? 'text-muted-foreground' : r.diff > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {r.diff > 0 ? `+${r.diff}` : r.diff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={() => setShowReview(false)} className="h-11 px-5 rounded-xl border font-semibold text-sm flex-1 hover:bg-slate-50">
              Seguir contando
            </button>
            <button
              onClick={confirmCount}
              disabled={saving}
              className="h-11 px-6 rounded-xl bg-[#1d1d1f] text-white font-bold text-sm inline-flex items-center gap-2 disabled:opacity-60 hover:opacity-90"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              Confirmar conteo
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatChip({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl px-4 py-2 ${warn ? 'border-amber-300' : ''}`}>
      <span className={`text-lg font-extrabold tabular-nums ${warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</span>
      <span className="text-xs text-muted-foreground ml-2">{label}</span>
    </div>
  );
}

function IconBtn({ onClick, label, danger, children }: { onClick: () => void; label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50 ${danger ? 'text-muted-foreground hover:text-red-500' : ''}`}
    >
      {children}
    </button>
  );
}
