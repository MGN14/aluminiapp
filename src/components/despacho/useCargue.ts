import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOnline } from '@/hooks/useOnline';
import { parseScan } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { fetchRefAliases } from '@/lib/remisionInventory';
import { buildPickPath, NO_LOC, type Bin, type ProductRef } from '@/lib/pickPath';
import {
  makeCanon, buildCargueLines, cargadoPorLinea, evaluarConteo, serialYaContado, resumenCargue,
  ordenarPorUbicacion, type CargueLine,
} from '@/lib/despachoCargue';
import {
  loadLocal, saveLocal, clearLocal, mergeEvents, enqueueInsert, undoLast, syncOps, aplicarResultadoSync,
  type CargueLocalState, type DispatchEvent, type SyncClient,
} from '@/lib/dispatchQueue';
import { cerrarDespacho, planearCierre, itemsParaImprimir, type CierreResultado, type ItemCierre } from '@/lib/despachoCierre';

export interface RemisionCargue {
  id: string;
  number: string;
  date: string;
  beneficiary: string | null;
  notes: string | null;
  status: string;
  remision_type: string;
  created_at: string | null;
  remision_items: ItemCierre[];
}

export type FlashKind = 'ok' | 'done' | 'warn' | 'error';
export interface Flash { kind: FlashKind; title: string; detail?: string; at: number }

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* contexto no seguro */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const SCAN_COLS = 'id, remision_id, reference, location, serial, quantity, scanned_at, operator_id';

export function useCargue(remisionId: string, practica: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const online = useOnline();

  // ── Datos ──────────────────────────────────────────────────────────────
  const remQuery = useQuery({
    queryKey: ['despacho-remision', remisionId],
    enabled: !!remisionId && !!userId,
    refetchInterval: practica ? false : 20_000, // la oficina puede editar el pedido mientras se carga
    queryFn: async () => {
      const { data, error } = await (supabase.from('remisiones') as any)
        .select('id, number, date, beneficiary, notes, status, remision_type, created_at, remision_items(id, reference, product_name, units, unit_cost)')
        .eq('id', remisionId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as RemisionCargue | null;
    },
  });

  // Alias confirmados a mano → objeto plano (el cache persistido es JSON: nunca Map).
  const { data: aliases = {} } = useQuery({
    queryKey: ['despacho-aliases', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () => Object.fromEntries(await fetchRefAliases()) as Record<string, string>,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['pick-products', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_products').select('id, reference, name').eq('active', true);
      if (error) throw error;
      return (data || []) as ProductRef[];
    },
  });

  const { data: locs = [] } = useQuery({
    queryKey: ['inventory-locations', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('inventory_locations').select('product_id, location, quantity, created_at');
      if (error) return [];
      return (data || []) as Array<{ product_id: string; location: string; quantity: number; created_at: string | null }>;
    },
  });

  // Estado COMPARTIDO: lo que ya subió al servidor (varios iPads suman al mismo pedido).
  const scansQuery = useQuery({
    queryKey: ['dispatch-scans', remisionId],
    enabled: !!remisionId && !practica,
    refetchInterval: online ? 3000 : false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('dispatch_scans').select(SCAN_COLS).eq('remision_id', remisionId);
      if (error) throw error;
      return (data || []) as DispatchEvent[];
    },
  });
  const serverEvents = useMemo(() => (practica ? [] : scansQuery.data ?? []), [practica, scansQuery.data]);

  // ── Estado local (cola + deshacer + fuera del pedido), persistido en el iPad ──
  const [local, setLocal] = useState<CargueLocalState>(() => loadLocal(remisionId, practica));
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => { saveLocal(remisionId, local, practica); }, [remisionId, local, practica]);

  // ── Derivados ──────────────────────────────────────────────────────────
  const remision = remQuery.data ?? null;
  const items = useMemo(() => remision?.remision_items ?? [], [remision]);
  const canon = useMemo(() => makeCanon(aliases), [aliases]);
  const lines = useMemo(() => buildCargueLines(items, canon), [items, canon]);
  const events = useMemo(() => mergeEvents(serverEvents, local.ops), [serverEvents, local.ops]);
  const cargado = useMemo(() => cargadoPorLinea(events, canon), [events, canon]);
  const resumen = useMemo(() => resumenCargue(lines, cargado), [lines, cargado]);

  const ubicaciones = useMemo(() => {
    // Todo por llave CANÓNICA (alias incluidos): "MN92" del pedido encuentra
    // las ubicaciones del producto "MN-92" del maestro.
    const productByRef = new Map<string, ProductRef>();
    for (const p of products) {
      const k = canon(p.reference ?? '');
      if (k && !productByRef.has(k)) productByRef.set(k, p);
    }
    const bins = new Map<string, Bin[]>();
    for (const l of locs) {
      const arr = bins.get(l.product_id) ?? [];
      arr.push({ location: l.location, quantity: Number(l.quantity) || 0, createdAt: l.created_at });
      bins.set(l.product_id, arr);
    }
    const steps = buildPickPath(lines.map((l) => ({ reference: l.key, name: l.name, needed: l.pedido })), productByRef, bins);
    const out: Record<string, string[]> = {};
    for (const s of steps) {
      if (s.location === NO_LOC) continue;
      for (const t of s.tasks) {
        const k = canon(t.reference);
        const arr = out[k] ?? (out[k] = []);
        if (!arr.includes(s.location)) arr.push(s.location);
      }
    }
    return out;
  }, [products, locs, lines, canon]);

  const orderedLines = useMemo(() => ordenarPorUbicacion(lines, ubicaciones), [lines, ubicaciones]);
  const operadores = useMemo(() => new Set(events.map((e) => e.operator_id).filter(Boolean)).size, [events]);

  const activeKey = useMemo(() => {
    if (local.activeKey && lines.some((l) => l.key === local.activeKey)) return local.activeKey;
    const sig = orderedLines.find((l) => (cargado[l.key] ?? 0) < l.pedido);
    return sig?.key ?? orderedLines[0]?.key ?? null;
  }, [local.activeKey, lines, orderedLines, cargado]);
  const activeLine: CargueLine | null = lines.find((l) => l.key === activeKey) ?? null;

  // ── Avisos ─────────────────────────────────────────────────────────────
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<number | null>(null);
  const showFlash = useCallback((kind: FlashKind, title: string, detail?: string) => {
    setFlash({ kind, title, detail, at: Date.now() });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), kind === 'ok' || kind === 'done' ? 2500 : 4500);
    if (kind === 'ok') beep('ok');
    else if (kind === 'done') { beep('ok'); window.setTimeout(() => beep('ok'), 140); }
    else beep('warn');
  }, []);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // ── Registrar conteos ──────────────────────────────────────────────────
  const addEvent = useCallback((row: { reference: string; quantity: number; serial?: string | null; location?: string | null }) => {
    const event: DispatchEvent = {
      id: newId(),
      remision_id: remisionId,
      reference: row.reference,
      location: row.location ?? null,
      serial: row.serial ?? null,
      quantity: row.quantity,
      scanned_at: new Date().toISOString(),
      operator_id: userId,
    };
    setLocal((cur) => enqueueInsert(cur, event));
  }, [remisionId, userId]);

  const avisarResultado = useCallback((line: CargueLine, qty: number, origen: 'scan' | 'manual') => {
    const r = evaluarConteo(lines, cargado, line.key, qty);
    if (r.tipo === 'fuera') return;
    const signo = qty > 0 ? `+${qty}` : `${qty}`;
    if (r.tipo === 'sobrante') showFlash('error', `${line.reference}: sobran ${r.nuevo - r.pedido}`, `Cargaste ${r.nuevo} y el pedido dice ${r.pedido}. Bajá lo que sobra.`);
    else if (r.tipo === 'completo') showFlash('done', `${line.reference} completa`, `${r.nuevo} de ${r.pedido}`);
    else if (origen === 'scan') showFlash('ok', `${line.reference} ${signo}`, `${r.nuevo} de ${r.pedido} · faltan ${r.pedido - r.nuevo}`);
  }, [lines, cargado, showFlash]);

  const handleScan = useCallback((raw: string) => {
    const parsed = parseScan(raw);
    if (!parsed) { showFlash('error', 'Código ilegible', 'Volvé a escanear la etiqueta.'); return; }
    const key = canon(parsed.reference);
    const line = lines.find((l) => l.key === key);
    if (!line) {
      const serial = (parsed.serial ?? '').trim().toLowerCase() || null;
      setLocal((cur) => (serial && cur.fuera.some((f) => (f.serial ?? '').toLowerCase() === serial)
        ? cur
        : {
          ...cur,
          fuera: [...cur.fuera, { id: newId(), reference: parsed.reference, quantity: parsed.quantity, at: new Date().toISOString(), serial }],
        }));
      showFlash('error', `${parsed.reference} NO va en este pedido`, 'Sacala del camión y marcala abajo como sacada.');
      return;
    }
    if (parsed.serial && serialYaContado(events, parsed.serial)) {
      showFlash('warn', 'Ese paquete ya se contó', `${parsed.serial} · no se sumó otra vez`);
      return;
    }
    addEvent({ reference: parsed.reference, quantity: parsed.quantity, serial: parsed.serial ?? null, location: parsed.location ?? null });
    setLocal((cur) => ({ ...cur, activeKey: key }));
    avisarResultado(line, parsed.quantity, 'scan');
  }, [canon, lines, events, addEvent, avisarResultado, showFlash]);

  const sumar = useCallback((key: string, n: number) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const actual = cargado[key] ?? 0;
    const delta = n < 0 ? Math.max(n, -actual) : n;
    if (delta === 0) return;
    addEvent({ reference: line.reference, quantity: delta });
    setLocal((cur) => ({ ...cur, activeKey: key }));
    avisarResultado(line, delta, 'manual');
  }, [lines, cargado, addEvent, avisarResultado]);

  const fijar = useCallback((key: string, valor: number) => {
    const actual = cargado[key] ?? 0;
    sumar(key, Math.max(0, Math.round(valor)) - actual);
  }, [cargado, sumar]);

  const completar = useCallback((key: string) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const falta = line.pedido - (cargado[key] ?? 0);
    if (falta > 0) sumar(key, falta);
  }, [lines, cargado, sumar]);

  const deshacer = useCallback(() => {
    const { state, undoneId } = undoLast(localRef.current);
    if (!undoneId) return;
    setLocal(state);
    showFlash('warn', 'Último conteo deshecho');
  }, [showFlash]);

  const setActive = useCallback((key: string) => setLocal((cur) => ({ ...cur, activeKey: key })), []);
  const resolverFuera = useCallback((id: string) => setLocal((cur) => ({ ...cur, fuera: cur.fuera.filter((f) => f.id !== id) })), []);

  // ── Subida en segundo plano ────────────────────────────────────────────
  const client: SyncClient = useMemo(() => ({
    insert: async (e) => {
      const { error } = await (supabase as any).from('dispatch_scans').insert({ ...e, user_id: userId });
      return { error };
    },
    remove: async (id) => {
      const { error } = await (supabase as any).from('dispatch_scans').delete().eq('id', id);
      return { error };
    },
  }), [userId]);

  const syncingRef = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    if (practica || syncingRef.current || !userId) return;
    const snapshot = localRef.current.ops;
    if (snapshot.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await syncOps(snapshot, client);
      // Primero traemos el servidor y DESPUÉS sacamos de la cola: así el
      // contador no "baja" un instante entre una cosa y la otra.
      if (result.done.length > 0) await qc.refetchQueries({ queryKey: ['dispatch-scans', remisionId] });
      setLocal((cur) => aplicarResultadoSync(cur, result));
      setSyncError(result.error);
      if (result.serialRechazados.length > 0) {
        const refs = result.serialRechazados.map((e) => e.reference).join(', ');
        showFlash('warn', 'Paquete contado dos veces', `Otro operario ya había escaneado ${refs}: se descontó.`);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [practica, userId, client, qc, remisionId, showFlash]);

  const pendientes = local.ops.length;
  useEffect(() => {
    if (practica || pendientes === 0 || !online) return;
    syncNow();
    // iOS a veces dice "en línea" con el wifi muerto: reintentamos cada 5 s.
    const t = window.setInterval(syncNow, 5000);
    return () => window.clearInterval(t);
  }, [practica, pendientes, online, syncNow]);

  // ── Cierre ─────────────────────────────────────────────────────────────
  const cerrar = useCallback(async (ajustar: boolean): Promise<CierreResultado & { practica: boolean }> => {
    if (practica) {
      const plan = planearCierre(items, cargado, aliases, ajustar);
      return {
        number: remision?.number ?? '',
        date: remision?.date ?? '',
        beneficiary: remision?.beneficiary ?? '',
        items: itemsParaImprimir(plan.items),
        resumen: plan.resumen,
        ajustada: plan.ajustada,
        inventarioOk: true,
        practica: true,
      };
    }
    if (!userId) throw new Error('Sin sesión');
    await syncNow();
    const quedan = localRef.current.ops.length;
    if (quedan > 0) throw new Error(`Faltan ${quedan} conteo${quedan === 1 ? '' : 's'} por subir. Revisá el wifi y volvé a intentar.`);
    const res = await cerrarDespacho({
      remisionId, cargado, aliases, ajustar, userId, operador: user?.email ?? '',
    });
    clearLocal(remisionId, false);
    setLocal({ ops: [], mine: [], fuera: [], activeKey: null });
    qc.invalidateQueries({ queryKey: ['remisiones'] });
    qc.invalidateQueries({ queryKey: ['despacho-por-cargar'] });
    qc.invalidateQueries({ queryKey: ['despacho-hoy'] });
    qc.invalidateQueries({ queryKey: ['despacho-remision', remisionId] });
    if (res.ajustada) {
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    }
    return { ...res, practica: false };
  }, [practica, items, cargado, aliases, remision, userId, syncNow, remisionId, user?.email, qc]);

  /** Salir de la práctica sin dejar rastro en el iPad. */
  const descartarPractica = useCallback(() => {
    clearLocal(remisionId, true);
    setLocal({ ops: [], mine: [], fuera: [], activeKey: null });
  }, [remisionId]);

  return {
    remision, loading: remQuery.isLoading, loadError: remQuery.error as Error | null,
    online, lines, orderedLines, cargado, resumen, ubicaciones, operadores,
    activeKey, activeLine, setActive,
    fuera: local.fuera, resolverFuera,
    puedeDeshacer: local.mine.length > 0,
    flash, handleScan, sumar, fijar, completar, deshacer,
    pendientes, syncing, syncError, syncNow,
    cerrar, descartarPractica,
  };
}

export type CargueApi = ReturnType<typeof useCargue>;
