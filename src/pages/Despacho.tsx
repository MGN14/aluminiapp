import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, normalizeRef } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import {
  ArrowLeft, Check, Plus, Minus, ScanLine, Truck, AlertTriangle, X,
  PackageCheck, Loader2, ChevronRight,
} from 'lucide-react';

interface RemItem { id: string; reference: string; product_name: string | null; units: number | null; }
interface Rem {
  id: string; date: string; number: string; beneficiary: string | null;
  status: string; module_origin: string; remision_type: string;
  remision_items: RemItem[];
}

interface Line { key: string; reference: string; name: string; expected: number; }

function formatDate(s: string) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export default function Despacho() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: remisiones = [], isLoading, refetch } = useQuery({
    queryKey: ['despacho-pendientes', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase.from('remisiones') as any)
        .select('id, date, number, beneficiary, status, module_origin, remision_type, remision_items(id, reference, product_name, units)')
        .eq('status', 'pendiente')
        .eq('remision_type', 'venta')
        .order('date', { ascending: false });
      if (error) throw error;
      return (data || []) as Rem[];
    },
    enabled: !!user?.id,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => remisiones.find(r => r.id === activeId) || null, [remisiones, activeId]);

  if (active) {
    return (
      <DispatchDetail
        key={active.id}
        remision={active}
        userId={user?.id ?? null}
        onBack={() => setActiveId(null)}
        onDispatched={() => { setActiveId(null); refetch(); }}
        toast={toast}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-white border-b px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-600/10 flex items-center justify-center">
            <Truck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Estación de despacho</h1>
            <p className="text-xs text-muted-foreground">Escaneá los paquetes para verificar cada remisión</p>
          </div>
        </div>
        <Link to="/remisiones" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Salir
        </Link>
      </header>

      <main className="max-w-3xl mx-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : remisiones.length === 0 ? (
          <div className="text-center py-24">
            <PackageCheck className="h-12 w-12 mx-auto text-green-500 mb-3" />
            <p className="text-lg font-semibold">No hay remisiones pendientes</p>
            <p className="text-sm text-muted-foreground mt-1">Todo despachado. Las remisiones de venta en estado “pendiente” aparecen acá.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground px-1">
              {remisiones.length} remisión{remisiones.length === 1 ? '' : 'es'} pendiente{remisiones.length === 1 ? '' : 's'} de despacho
            </p>
            {remisiones.map(r => {
              const items = r.remision_items || [];
              const refs = new Set(items.map(i => normalizeRef(i.reference)).filter(Boolean)).size;
              const units = items.reduce((s, i) => s + (Number(i.units) || 0), 0);
              return (
                <button
                  key={r.id}
                  onClick={() => { beep('ok'); setActiveId(r.id); }}
                  className="w-full text-left bg-white rounded-2xl border p-4 sm:p-5 flex items-center justify-between hover:border-blue-400 hover:shadow-sm transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">{r.number}</span>
                      {r.module_origin === 'gerencial' && (
                        <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Gerencial</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">{r.beneficiary || 'Sin beneficiario'}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(r.date)} · {refs} referencia{refs === 1 ? '' : 's'} · {units} unidades
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────── Vista de verificación por escaneo ───────────────────────

interface DetailProps {
  remision: Rem;
  userId: string | null;
  onBack: () => void;
  onDispatched: () => void;
  toast: ReturnType<typeof useToast>['toast'];
}

function DispatchDetail({ remision, userId, onBack, onDispatched, toast }: DetailProps) {
  const lines: Line[] = useMemo(() => {
    const map = new Map<string, Line>();
    for (const it of remision.remision_items || []) {
      const key = normalizeRef(it.reference);
      if (!key) continue;
      const prev = map.get(key);
      if (prev) prev.expected += Number(it.units) || 0;
      else map.set(key, { key, reference: it.reference, name: it.product_name || '', expected: Number(it.units) || 0 });
    }
    return Array.from(map.values());
  }, [remision]);

  const lineKeys = useMemo(() => new Set(lines.map(l => l.key)), [lines]);
  const expectedByKey = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach(l => m.set(l.key, l.expected));
    return m;
  }, [lines]);

  const storageKey = `despacho:scan:${remision.id}`;
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [extras, setExtras] = useState<{ reference: string; quantity: number }[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'warn' | 'over'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const flashTimer = useRef<number | null>(null);

  // Restaurar progreso (sobrevive un refresh accidental de la tablet).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const o = JSON.parse(raw);
        setScanned(o.scanned || {});
        setExtras(o.extras || []);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ scanned, extras })); } catch { /* ignore */ }
  }, [storageKey, scanned, extras]);

  const flashMsg = useCallback((kind: 'ok' | 'warn' | 'over', text: string) => {
    setFlash({ kind, text });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, []);

  const handleScan = useCallback((raw: string) => {
    const parsed = parseScan(raw);
    if (!parsed) { flashMsg('warn', 'Código ilegible'); beep('warn'); return; }
    const key = normalizeRef(parsed.reference);
    if (lineKeys.has(key)) {
      setScanned(prev => {
        const exp = expectedByKey.get(key) || 0;
        const nextVal = (prev[key] || 0) + parsed.quantity;
        if (nextVal > exp) { flashMsg('over', `${parsed.reference}  +${parsed.quantity} → ${nextVal}/${exp} (pasa)`); beep('warn'); }
        else { flashMsg('ok', `${parsed.reference}  +${parsed.quantity} → ${nextVal}/${exp}`); beep('ok'); }
        return { ...prev, [key]: nextVal };
      });
    } else {
      setExtras(prev => [{ reference: parsed.reference, quantity: parsed.quantity }, ...prev].slice(0, 50));
      flashMsg('warn', `${parsed.reference} no está en esta remisión`);
      beep('warn');
    }
  }, [lineKeys, expectedByKey, flashMsg]);

  useScannerGun({ onScan: handleScan, enabled: !saving });

  const adjust = (key: string, delta: number) =>
    setScanned(prev => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) + delta) }));

  const complete = (key: string) =>
    setScanned(prev => ({ ...prev, [key]: expectedByKey.get(key) || 0 }));

  const doneCount = lines.filter(l => (scanned[l.key] || 0) >= l.expected).length;
  const allComplete = lines.length > 0 && doneCount === lines.length;
  const totalScanned = lines.reduce((s, l) => s + (scanned[l.key] || 0), 0)
    + extras.reduce((s, e) => s + e.quantity, 0);

  const despachar = async () => {
    if (!allComplete) {
      const ok = window.confirm('Hay líneas incompletas. ¿Marcar como despachado igual?');
      if (!ok) return;
    }
    setSaving(true);
    const { error } = await (supabase.from('remisiones') as any)
      .update({
        status: 'despachado',
        verified_at: new Date().toISOString(),
        verified_by: userId,
        verified_units: totalScanned,
      })
      .eq('id', remision.id);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo despachar', description: error.message, variant: 'destructive' });
      return;
    }
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    toast({ title: `${remision.number} despachada`, description: `${totalScanned} unidades verificadas.` });
    onDispatched();
  };

  const flashColor = flash?.kind === 'ok' ? 'bg-green-600'
    : flash?.kind === 'over' ? 'bg-amber-500' : 'bg-red-600';

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" /> Volver
          </button>
          <div className="text-right min-w-0">
            <div className="font-bold leading-tight">{remision.number}</div>
            <div className="text-xs text-muted-foreground truncate">{remision.beneficiary || 'Sin beneficiario'}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full transition-all ${allComplete ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${lines.length ? (doneCount / lines.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">{doneCount}/{lines.length} líneas</span>
        </div>
      </header>

      {/* Banner de feedback del último escaneo */}
      <div className="px-4 pt-3">
        <div className={`rounded-xl px-4 py-3 text-white font-semibold flex items-center gap-2 transition ${flash ? flashColor : 'bg-slate-300'}`}>
          {flash ? (
            flash.kind === 'ok' ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />
          ) : (
            <ScanLine className="h-5 w-5" />
          )}
          <span className="truncate">{flash ? flash.text : 'Escaneá un paquete…'}</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-3 space-y-2.5">
        {lines.map(l => {
          const got = scanned[l.key] || 0;
          const done = got >= l.expected;
          const over = got > l.expected;
          return (
            <div
              key={l.key}
              className={`bg-white rounded-2xl border p-3.5 flex items-center gap-3 ${done ? 'border-green-300 bg-green-50/40' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold text-base truncate flex items-center gap-2">
                  {done && <Check className="h-4 w-4 text-green-600 flex-shrink-0" />}
                  {l.reference}
                </div>
                {l.name && <div className="text-xs text-muted-foreground truncate">{l.name}</div>}
              </div>
              <div className="text-right">
                <div className={`text-2xl font-extrabold tabular-nums leading-none ${over ? 'text-amber-600' : done ? 'text-green-600' : 'text-slate-800'}`}>
                  {got}<span className="text-base text-muted-foreground font-bold">/{l.expected}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => adjust(l.key, -1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Restar uno">
                  <Minus className="h-4 w-4" />
                </button>
                <button onClick={() => adjust(l.key, +1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Sumar uno">
                  <Plus className="h-4 w-4" />
                </button>
                {!done && (
                  <button onClick={() => complete(l.key)} className="h-10 px-3 rounded-xl border text-xs font-semibold flex items-center active:scale-95 hover:bg-slate-50" aria-label="Completar línea">
                    OK
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {extras.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mt-3">
            <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm mb-2">
              <AlertTriangle className="h-4 w-4" /> Escaneos fuera de la remisión ({extras.length})
            </div>
            <div className="space-y-1.5">
              {extras.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                  <span className="font-medium truncate">{e.reference} <span className="text-muted-foreground">×{e.quantity}</span></span>
                  <button onClick={() => setExtras(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500" aria-label="Quitar">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer fijo: marcar despachado */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="text-sm text-muted-foreground flex-1">
            <span className="font-semibold text-foreground tabular-nums">{totalScanned}</span> unidades escaneadas
          </div>
          <button
            onClick={despachar}
            disabled={saving}
            className={`h-12 px-6 rounded-2xl font-bold text-white flex items-center gap-2 active:scale-[0.98] disabled:opacity-60 ${allComplete ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-500 hover:bg-amber-600'}`}
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
            {allComplete ? 'Marcar despachado' : 'Despachar incompleto'}
          </button>
        </div>
      </div>
    </div>
  );
}
