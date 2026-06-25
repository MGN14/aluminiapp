import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, normalizeRef } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { printRemisionToWindow } from '@/lib/printRemision';
import { buildPickPath, NO_LOC, type PickStep, type PickTask, type ProductRef, type Bin } from '@/lib/pickPath';
import {
  ArrowLeft, ArrowRight, Check, Plus, Minus, ScanLine, Truck, AlertTriangle,
  RadioTower, Loader2, MapPin, Undo2, User, Users,
} from 'lucide-react';

export interface CompanyInfo {
  company_name?: string | null; company_nit?: string | null; company_address?: string | null; company_city?: string | null;
}
interface RemItem { id: string; reference: string; product_name: string | null; units: number | null; }
interface Rem { id: string; date: string; number: string; beneficiary: string | null; remision_items: RemItem[]; }
interface ScanRow { id: string; reference: string; location: string | null; serial: string | null; quantity: number; scanned_at: string; operator_id: string | null; }

interface Props {
  remision: Rem;
  company: CompanyInfo | null | undefined;
  userId: string | null;
  toast: ReturnType<typeof useToast>['toast'];
  onBack: () => void;
  onDispatched: () => void;
}

export default function GuidedPick({ remision, company, userId, toast, onBack, onDispatched }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: products = [], isLoading: loadingP } = useQuery({
    queryKey: ['pick-products', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_products').select('id, reference, name').eq('active', true);
      if (error) throw error;
      return (data || []) as ProductRef[];
    },
    enabled: !!user?.id,
  });
  const { data: locs = [], isLoading: loadingL } = useQuery({
    queryKey: ['inventory-locations', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('inventory_locations').select('product_id, location, quantity, created_at');
      if (error) throw error;
      return (data || []) as Array<{ product_id: string; location: string; quantity: number; created_at: string | null }>;
    },
    enabled: !!user?.id,
  });

  // Estado COMPARTIDO del despacho: eventos de escaneo en el servidor. Poolea
  // cada 2.5s → varios operarios suman al mismo pedido y se ven en vivo.
  const { data: scans = [] } = useQuery({
    queryKey: ['dispatch-scans', remision.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('dispatch_scans')
        .select('id, reference, location, serial, quantity, scanned_at, operator_id')
        .eq('remision_id', remision.id);
      if (error) throw error;
      return (data || []) as ScanRow[];
    },
    enabled: !!remision.id,
    refetchInterval: 2500,
  });
  const refreshScans = useCallback(() => { qc.invalidateQueries({ queryKey: ['dispatch-scans', remision.id] }); }, [qc, remision.id]);

  const productByRef = useMemo(() => {
    const m = new Map<string, ProductRef>();
    for (const p of products) { const k = normalizeRef(p.reference); if (k) m.set(k, p); }
    return m;
  }, [products]);
  const binsByProduct = useMemo(() => {
    const m = new Map<string, Bin[]>();
    for (const l of locs) { const arr = m.get(l.product_id) ?? []; arr.push({ location: l.location, quantity: Number(l.quantity) || 0, createdAt: l.created_at }); m.set(l.product_id, arr); }
    return m;
  }, [locs]);

  const steps: PickStep[] = useMemo(() => {
    const lines = (remision.remision_items || []).map(it => ({ reference: it.reference, name: it.product_name || '', needed: Number(it.units) || 0 }));
    return buildPickPath(lines, productByRef, binsByProduct);
  }, [remision, productByRef, binsByProduct]);

  // Agrega los eventos del servidor a "cuánto se escaneó por tarea".
  const scannedByTask = useMemo(() => {
    const tasks = steps.flatMap(s => s.tasks);
    const result: Record<string, number> = {};
    for (const t of tasks) result[t.key] = 0;
    const exact = new Map<string, number>();
    const loose = new Map<string, number>();
    for (const sc of scans) {
      const ref = normalizeRef(sc.reference || '');
      const loc = (sc.location || '').trim().toUpperCase();
      const q = Number(sc.quantity) || 0;
      if (loc) exact.set(`${ref}|${loc}`, (exact.get(`${ref}|${loc}`) || 0) + q);
      else loose.set(ref, (loose.get(ref) || 0) + q);
    }
    for (const t of tasks) {
      const k = `${normalizeRef(t.reference)}|${t.location}`;
      if (exact.has(k)) { result[t.key] += exact.get(k)!; exact.delete(k); }
    }
    // Ubicaciones escaneadas sin tarea exacta → se tratan como sueltas de su ref.
    for (const [k, q] of exact) { const ref = k.split('|')[0]; loose.set(ref, (loose.get(ref) || 0) + q); }
    const tasksByRef = new Map<string, PickTask[]>();
    for (const t of tasks) { const r = normalizeRef(t.reference); const arr = tasksByRef.get(r) ?? []; arr.push(t); tasksByRef.set(r, arr); }
    for (const [ref, qty] of loose) {
      let remaining = qty;
      const refTasks = tasksByRef.get(ref) ?? [];
      for (const t of refTasks) {
        if (remaining <= 0) break;
        const room = Math.max(0, t.qty - result[t.key]);
        const take = Math.min(room, remaining);
        result[t.key] += take; remaining -= take;
      }
      if (remaining > 0 && refTasks.length) result[refTasks[refTasks.length - 1].key] += remaining;
    }
    for (const k in result) result[k] = Math.max(0, result[k]);
    return result;
  }, [steps, scans]);

  const [stepIdx, setStepIdx] = useState(0);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'warn' | 'over'; text: string } | null>(null);
  const [lastTaskKey, setLastTaskKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const myScanIds = useRef<string[]>([]); // ids de mis inserts (para deshacer)

  const stepKey = `despacho:pick:step:${remision.id}`;
  useEffect(() => {
    try { const raw = localStorage.getItem(stepKey); if (raw != null) setStepIdx(Number(raw) || 0); } catch { /* ignore */ }
  }, [stepKey]);
  useEffect(() => {
    try { localStorage.setItem(stepKey, String(stepIdx)); } catch { /* ignore */ }
  }, [stepKey, stepIdx]);

  const flashMsg = useCallback((kind: 'ok' | 'warn' | 'over', text: string) => {
    setFlash({ kind, text });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, []);

  const step = steps[stepIdx];
  const stepDone = (s?: PickStep) => !!s && s.tasks.every(t => (scannedByTask[t.key] || 0) >= t.qty);
  const allDone = steps.length > 0 && steps.every(s => stepDone(s));
  const totalScanned = useMemo(() => Object.values(scannedByTask).reduce((s, n) => s + n, 0), [scannedByTask]);
  // Cuántos operarios distintos sumaron a este pedido (info de coordinación).
  const operatorCount = useMemo(() => new Set(scans.map(s => s.operator_id).filter(Boolean)).size, [scans]);

  const insertScan = async (row: { reference: string; location?: string | null; serial?: string | null; quantity: number }) => {
    const { data, error } = await (supabase as any).from('dispatch_scans').insert({
      remision_id: remision.id, user_id: userId, reference: row.reference,
      location: row.location || null, serial: row.serial || null, quantity: row.quantity, operator_id: userId,
    }).select('id').single();
    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(String(error.message || ''))) return { duplicate: true as const };
      throw error;
    }
    return { id: (data as { id: string } | null)?.id };
  };

  const handleScan = useCallback(async (raw: string) => {
    if (!step || saving) return;
    const parsed = parseScan(raw);
    if (!parsed) { flashMsg('warn', 'Código ilegible'); beep('warn'); return; }
    const ref = normalizeRef(parsed.reference);
    const loc = (parsed.location || '').trim().toUpperCase();
    let task = step.tasks.find(t => normalizeRef(t.reference) === ref && (loc ? t.location === loc : true) && (scannedByTask[t.key] || 0) < t.qty);
    if (!task) task = step.tasks.find(t => normalizeRef(t.reference) === ref && (scannedByTask[t.key] || 0) < t.qty);
    if (!task) {
      const other = steps.findIndex((s, i) => i !== stepIdx && s.tasks.some(t => normalizeRef(t.reference) === ref));
      if (step.tasks.some(t => normalizeRef(t.reference) === ref)) flashMsg('warn', `${parsed.reference} ya completo acá`);
      else if (other >= 0) flashMsg('warn', `${parsed.reference} va en ${steps[other].location}`);
      else flashMsg('warn', `${parsed.reference} fuera del pedido`);
      beep('warn');
      return;
    }
    try {
      const res = await insertScan({ reference: parsed.reference, location: parsed.location || task.location, serial: parsed.serial, quantity: parsed.quantity });
      if ('duplicate' in res && res.duplicate) { flashMsg('warn', `Ese paquete (${parsed.serial}) ya fue escaneado`); beep('warn'); return; }
      if (res.id) myScanIds.current.push(res.id);
      const nv = (scannedByTask[task.key] || 0) + parsed.quantity;
      if (nv > task.qty) { flashMsg('over', `${task.reference} +${parsed.quantity} → ${nv}/${task.qty} (pasa)`); beep('warn'); }
      else { flashMsg('ok', `${task.reference} +${parsed.quantity} → ${nv}/${task.qty}`); beep('ok'); }
      setLastTaskKey(task.key);
      refreshScans();
    } catch (e: any) {
      flashMsg('warn', 'No se pudo registrar el escaneo');
      beep('warn');
    }
  }, [step, steps, stepIdx, scannedByTask, saving, flashMsg, refreshScans]); // eslint-disable-line react-hooks/exhaustive-deps

  useScannerGun({ onScan: handleScan, enabled: !saving });

  const adjust = async (task: PickTask, delta: number) => {
    if (delta > 0) {
      const res = await insertScan({ reference: task.reference, location: task.location, quantity: 1 });
      if (!('duplicate' in res) && res.id) myScanIds.current.push(res.id);
    } else {
      const ref = normalizeRef(task.reference);
      const cands = scans.filter(s => normalizeRef(s.reference) === ref && ((s.location || '').trim().toUpperCase() === task.location || !(s.location || '').trim()));
      if (cands.length === 0) return;
      const target = cands.reduce((a, b) => (a.scanned_at > b.scanned_at ? a : b));
      await (supabase as any).from('dispatch_scans').delete().eq('id', target.id);
    }
    refreshScans();
  };

  const completeTask = async (task: PickTask) => {
    const remaining = task.qty - (scannedByTask[task.key] || 0);
    if (remaining <= 0) return;
    const res = await insertScan({ reference: task.reference, location: task.location, quantity: remaining });
    if (!('duplicate' in res) && res.id) myScanIds.current.push(res.id);
    refreshScans();
  };

  const undoLast = async () => {
    const id = myScanIds.current.pop();
    if (!id) return;
    await (supabase as any).from('dispatch_scans').delete().eq('id', id);
    setLastTaskKey(null);
    flashMsg('warn', 'Último escaneo deshecho');
    beep('warn');
    refreshScans();
  };

  const despachar = async () => {
    if (!allDone && !window.confirm('Hay tareas incompletas en el pedido. ¿Marcar despachado igual?')) return;
    const printWin = window.open('', '_blank', 'width=820,height=1040');
    setSaving(true);
    try {
      const { error } = await (supabase.from('remisiones') as any)
        .update({ status: 'despachado', verified_at: new Date().toISOString(), verified_by: userId, verified_units: totalScanned })
        .eq('id', remision.id);
      if (error) throw error;
      try { localStorage.removeItem(stepKey); } catch { /* ignore */ }
      if (printWin) {
        printRemisionToWindow(printWin, {
          company: { name: company?.company_name, nit: company?.company_nit, address: company?.company_address, city: company?.company_city },
          number: remision.number,
          date: remision.date,
          beneficiary: remision.beneficiary || '',
          items: (remision.remision_items || []).map(i => ({ reference: i.reference, product_name: i.product_name || '', units: Number(i.units) || 0 })),
        });
      }
      toast({ title: `${remision.number} despachada`, description: `${totalScanned} unidades verificadas.` });
      navigate('/remisiones');
      onDispatched();
    } catch (e: any) {
      if (printWin) { try { printWin.close(); } catch { /* ignore */ } }
      toast({ title: 'No se pudo despachar', description: e.message, variant: 'destructive' });
      setSaving(false);
    }
  };

  if (loadingP || loadingL) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const isLast = stepIdx >= steps.length - 1;
  const curDone = stepDone(step);
  const accent = flash?.kind === 'ok' ? 'green' : flash?.kind === 'over' ? 'amber' : flash ? 'red' : 'idle';
  const noLoc = step?.location === NO_LOC;

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" /> Pedidos
          </button>
          <div className="text-right min-w-0">
            <div className="font-bold leading-tight">{remision.number}</div>
            <div className="text-xs text-muted-foreground truncate">{remision.beneficiary || 'Sin beneficiario'}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground -mt-1">
          {user?.email && <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {user.email}</span>}
          {operatorCount > 1 && <span className="inline-flex items-center gap-1.5 text-blue-600 font-semibold"><Users className="h-3.5 w-3.5" /> {operatorCount} operarios en este pedido</span>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${steps.length ? ((stepIdx + (curDone ? 1 : 0)) / steps.length) * 100 : 0}%` }} />
          </div>
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">Paso {Math.min(stepIdx + 1, steps.length)}/{steps.length}</span>
        </div>

        {step && (
          <div className={`rounded-2xl border-2 px-5 py-4 flex items-center gap-4 ${noLoc ? 'border-amber-300 bg-amber-50/50' : 'border-blue-300 bg-blue-50/40'}`}>
            <div className={`h-14 w-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${noLoc ? 'bg-amber-500' : 'bg-blue-600'} text-white`}><MapPin className="h-7 w-7" /></div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{noLoc ? 'Sin ubicación asignada' : 'Andá a la ubicación'}</div>
              <div className="text-3xl font-extrabold leading-none">{step.location}</div>
            </div>
            {curDone && <Check className="h-7 w-7 text-emerald-600 ml-auto flex-shrink-0" />}
          </div>
        )}

        <div className={`rounded-xl border-2 px-4 py-3 flex items-center gap-3 transition-colors ${
          accent === 'green' ? 'border-emerald-400 bg-emerald-50/50' : accent === 'amber' ? 'border-amber-400 bg-amber-50/50' : accent === 'red' ? 'border-red-300 bg-red-50/50' : 'border-dashed border-slate-300 bg-white'
        }`}>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            accent === 'green' ? 'bg-emerald-500 text-white' : accent === 'amber' ? 'bg-amber-500 text-white' : accent === 'red' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-400'
          }`}>
            {accent === 'green' ? <Check className="h-5 w-5" /> : accent === 'idle' ? <RadioTower className="h-5 w-5 animate-pulse" /> : <AlertTriangle className="h-5 w-5" />}
          </div>
          <span className="font-semibold truncate text-sm">{flash ? flash.text : 'Escaneá lo de esta ubicación…'}</span>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {myScanIds.current.length > 0 && (
              <button onClick={undoLast} className="h-8 px-2.5 rounded-lg border bg-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-slate-50">
                <Undo2 className="h-3.5 w-3.5" /> Deshacer
              </button>
            )}
            <ScanLine className="h-5 w-5 text-slate-300 hidden sm:block" />
          </div>
        </div>

        <div className="space-y-2.5">
          {step?.tasks.map(t => {
            const got = scannedByTask[t.key] || 0;
            const done = got >= t.qty;
            const over = got > t.qty;
            return (
              <div key={t.key} className={`bg-white rounded-2xl border p-3.5 flex items-center gap-3 ${done ? 'border-green-300 bg-green-50/40' : ''} ${t.key === lastTaskKey ? 'ring-2 ring-offset-1 ring-emerald-400' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-base truncate flex items-center gap-2">{done && <Check className="h-4 w-4 text-green-600 flex-shrink-0" />}{t.reference}</div>
                  {t.name && <div className="text-xs text-muted-foreground truncate">{t.name}</div>}
                </div>
                <div className={`text-2xl font-extrabold tabular-nums leading-none ${over ? 'text-amber-600' : done ? 'text-green-600' : 'text-slate-800'}`}>{got}<span className="text-base text-muted-foreground font-bold">/{t.qty}</span></div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => adjust(t, -1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Restar uno"><Minus className="h-4 w-4" /></button>
                  <button onClick={() => adjust(t, +1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Sumar uno"><Plus className="h-4 w-4" /></button>
                  {!done && <button onClick={() => completeTask(t)} className="h-10 px-3 rounded-xl border text-xs font-semibold flex items-center active:scale-95 hover:bg-slate-50">OK</button>}
                </div>
              </div>
            );
          })}
          {steps.length === 0 && <div className="text-center text-sm text-muted-foreground py-10 border border-dashed rounded-2xl bg-white">Este pedido no tiene ítems.</div>}
        </div>

        <div className="flex items-center gap-3 pt-1">
          {stepIdx > 0 && (
            <button onClick={() => setStepIdx(stepIdx - 1)} className="h-12 px-4 rounded-2xl border font-medium text-sm text-muted-foreground hover:bg-slate-50 inline-flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> Anterior
            </button>
          )}
          <div className="text-sm text-muted-foreground flex-1 text-center">
            <span className="font-semibold text-foreground tabular-nums">{totalScanned}</span> und escaneadas
          </div>
          {!isLast ? (
            <button
              onClick={() => { if (curDone || window.confirm('Esta ubicación está incompleta. ¿Avanzar igual?')) setStepIdx(stepIdx + 1); }}
              className={`h-12 px-6 rounded-2xl font-bold text-white flex items-center gap-2 active:scale-[0.98] ${curDone ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-400 hover:bg-slate-500'}`}
            >
              Siguiente ubicación <ArrowRight className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={despachar}
              disabled={saving}
              className={`h-12 px-6 rounded-2xl font-bold text-white flex items-center gap-2 active:scale-[0.98] disabled:opacity-60 ${allDone ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-500 hover:bg-amber-600'}`}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
              {allDone ? 'Despachar e imprimir' : 'Despachar incompleto'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
