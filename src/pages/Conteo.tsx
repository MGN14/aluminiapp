import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, normalizeRef } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Check, Plus, Minus, ScanLine, ClipboardCheck, AlertTriangle, X,
  Loader2, Trash2, Save,
} from 'lucide-react';

interface Prod { id: string; reference: string; name: string; stock_system: number; }
interface CountEntry { reference: string; quantity: number; }

const STORAGE_KEY = 'conteo:session:v1';

export default function Conteo() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: products = [] } = useQuery({
    queryKey: ['conteo-products', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_products')
        .select('id, reference, name, stock_system')
        .eq('active', true);
      if (error) throw error;
      return (data || []) as Prod[];
    },
    enabled: !!user?.id,
  });

  const productByRef = useMemo(() => {
    const m = new Map<string, Prod>();
    for (const p of products) {
      const k = normalizeRef(p.reference);
      if (k) m.set(k, p);
    }
    return m;
  }, [products]);

  // Tally por referencia normalizada. Persistido: el conteo puede durar horas y
  // sobrevive un refresh / bloqueo de la tablet.
  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const [order, setOrder] = useState<string[]>([]); // refs en orden de aparición (más reciente primero)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualRef, setManualRef] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const flashTimer = useRef<number | null>(null);

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

  const flashMsg = useCallback((kind: 'ok' | 'warn', text: string) => {
    setFlash({ kind, text });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  }, []);

  const addCount = useCallback((rawRef: string, qty: number) => {
    const key = normalizeRef(rawRef);
    if (!key) return;
    const prod = productByRef.get(key);
    const displayRef = prod?.reference ?? rawRef.trim();
    setCounts(prev => {
      const cur = prev[key];
      return { ...prev, [key]: { reference: displayRef, quantity: (cur?.quantity || 0) + qty } };
    });
    setOrder(prev => [key, ...prev.filter(k => k !== key)]);
    if (prod) { flashMsg('ok', `${displayRef}  +${qty}`); beep('ok'); }
    else { flashMsg('warn', `${displayRef} — sin match en inventario`); beep('warn'); }
  }, [productByRef, flashMsg]);

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

  const distinctRefs = order.length;
  const totalUnits = useMemo(() => Object.values(counts).reduce((s, c) => s + c.quantity, 0), [counts]);
  const matchedKeys = useMemo(() => order.filter(k => productByRef.has(k)), [order, productByRef]);
  const unmatchedKeys = useMemo(() => order.filter(k => !productByRef.has(k)), [order, productByRef]);

  const reviewRows = useMemo(() =>
    matchedKeys.map(k => {
      const prod = productByRef.get(k)!;
      const counted = counts[k]?.quantity || 0;
      return { id: prod.id, reference: prod.reference, name: prod.name, counted, system: Number(prod.stock_system) || 0, diff: (Number(prod.stock_system) || 0) - counted };
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
    [matchedKeys, counts, productByRef]);

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualRef.trim() || manualQty <= 0) return;
    addCount(manualRef, manualQty);
    setManualRef('');
    setManualQty(1);
    // Soltar el foco del input para que la pistola vuelva a capturar escaneos
    // (el hook ignora teclas mientras hay un campo de texto enfocado).
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
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      setCounts({});
      setOrder([]);
      setShowReview(false);
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

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-10 bg-white border-b px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Conteo físico</h1>
            <p className="text-xs text-muted-foreground">Escaneá los paquetes; al cerrar se actualiza el stock físico</p>
          </div>
        </div>
        <Link to="/inventarios" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Salir
        </Link>
      </header>

      {/* Feedback del último escaneo */}
      <div className="px-4 pt-3 max-w-3xl mx-auto">
        <div className={`rounded-xl px-4 py-3 text-white font-semibold flex items-center gap-2 transition ${flash ? (flash.kind === 'ok' ? 'bg-green-600' : 'bg-red-600') : 'bg-slate-300'}`}>
          {flash ? (flash.kind === 'ok' ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />) : <ScanLine className="h-5 w-5" />}
          <span className="truncate">{flash ? flash.text : 'Escaneá un paquete…'}</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-3 space-y-3">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Referencias" value={distinctRefs} />
          <Stat label="Unidades" value={totalUnits} />
          <Stat label="Sin match" value={unmatchedKeys.length} warn={unmatchedKeys.length > 0} />
        </div>

        {/* Carga manual (cuando falta etiqueta) */}
        <form onSubmit={handleManualAdd} className="flex items-end gap-2 bg-white border rounded-2xl p-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground">Agregar manual (sin etiqueta)</label>
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
          <div className="w-20">
            <label className="text-xs font-medium text-muted-foreground">Cant.</label>
            <Input type="number" min={1} value={manualQty || ''} onChange={e => setManualQty(+e.target.value)} className="mt-1 text-center font-mono" />
          </div>
          <button type="submit" className="h-10 px-4 rounded-xl border font-semibold text-sm flex items-center gap-1 active:scale-95 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Sumar
          </button>
        </form>

        {/* Lista de conteo */}
        {order.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-16 border border-dashed rounded-2xl bg-white">
            Escaneá el primer paquete para empezar el conteo.
          </div>
        ) : (
          <div className="space-y-2">
            {order.map(key => {
              const c = counts[key];
              if (!c) return null;
              const prod = productByRef.get(key);
              return (
                <div key={key} className={`bg-white rounded-2xl border p-3.5 flex items-center gap-3 ${!prod ? 'border-amber-300 bg-amber-50/40' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-base truncate">{c.reference}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {prod ? prod.name : 'No está en el inventario — no se guardará'}
                    </div>
                  </div>
                  <div className="text-2xl font-extrabold tabular-nums text-slate-800 leading-none">{c.quantity}</div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => adjust(key, -1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Restar uno">
                      <Minus className="h-4 w-4" />
                    </button>
                    <button onClick={() => adjust(key, +1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Sumar uno">
                      <Plus className="h-4 w-4" />
                    </button>
                    <button onClick={() => removeKey(key)} className="h-10 w-10 rounded-xl border flex items-center justify-center text-muted-foreground hover:text-red-500 active:scale-95" aria-label="Quitar">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer: cerrar conteo */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="text-sm text-muted-foreground flex-1">
            <span className="font-semibold text-foreground tabular-nums">{matchedKeys.length}</span> referencias listas para guardar
          </div>
          <button
            onClick={() => setShowReview(true)}
            disabled={matchedKeys.length === 0}
            className="h-12 px-6 rounded-2xl font-bold text-white bg-orange-500 hover:bg-orange-600 flex items-center gap-2 active:scale-[0.98] disabled:opacity-60"
          >
            <Save className="h-5 w-5" /> Cerrar conteo
          </button>
        </div>
      </div>

      {/* Panel de revisión / confirmación */}
      {showReview && (
        <div className="fixed inset-0 z-20 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-bold text-base">Revisar conteo</h2>
              <button onClick={() => setShowReview(false)} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-3 text-sm text-muted-foreground border-b">
              Se actualizará el <strong>stock físico</strong> de {reviewRows.length} referencia{reviewRows.length === 1 ? '' : 's'}.
              {unmatchedKeys.length > 0 && (
                <span className="text-amber-600"> {unmatchedKeys.length} sin match en inventario se ignoran.</span>
              )}
            </div>
            <div className="overflow-auto flex-1">
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
            <div className="px-5 py-4 border-t flex items-center gap-3">
              <button onClick={() => setShowReview(false)} className="h-11 px-5 rounded-xl border font-semibold text-sm flex-1 hover:bg-slate-50">
                Seguir contando
              </button>
              <button
                onClick={confirmCount}
                disabled={saving}
                className="h-11 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                Confirmar conteo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`bg-white border rounded-2xl px-3 py-3 text-center ${warn ? 'border-amber-300' : ''}`}>
      <div className={`text-2xl font-extrabold tabular-nums leading-none ${warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
