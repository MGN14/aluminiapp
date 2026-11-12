import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOnline } from '@/hooks/useOnline';
import { parseScan } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { fetchRefAliases } from '@/lib/remisionInventory';
import { fetchAllPaged } from '@/lib/fetchAllPaged';
import { buildPickPath, NO_LOC, type Bin, type ProductRef } from '@/lib/pickPath';
import {
  makeCanon, buildCargueLines, cargadoPorLinea, evaluarConteo, serialYaContado, resumenCargue,
  type CargueLine,
} from '@/lib/despachoCargue';
import {
  cargadoEnPaquetes, paquetesDe, siguientePaquete, type EmpaqueRef, type ImportItemLite, type ProductoEmpaque,
} from '@/lib/cargueEmpaque';
import {
  loadLocal, saveLocal, clearLocal, mergeEvents, enqueueInsert, undoLast, quitarEvento, syncOps, aplicarResultadoSync,
  type CargueLocalState, type DispatchEvent, type SyncClient,
} from '@/lib/dispatchQueue';
import { cerrarDespacho, planearCierre, itemsParaImprimir, type CierreResultado, type ItemCierre } from '@/lib/despachoCierre';
import { cargarEmpaquesVariantes } from '@/lib/referenciaEmpaque';

export interface RemisionCargue {
  id: string;
  number: string;
  date: string;
  beneficiary: string | null;
  notes: string | null;
  status: string;
  remision_type: string;
  created_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
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
const fmt = (n: number) => n.toLocaleString('es-CO');

// ═══════════════════════════ Datos de la remisión ═══════════════════════════

/** Remisión, alias, ubicaciones y lo que hace falta para empaque y peso. */
export function useCargueDatos(remisionId: string) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const remQuery = useQuery({
    queryKey: ['cargue-remision', remisionId],
    enabled: !!remisionId && !!userId,
    refetchInterval: 20_000, // la oficina puede editar el pedido mientras se carga
    queryFn: async () => {
      const { data, error } = await (supabase.from('remisiones') as any)
        .select('id, number, date, beneficiary, notes, status, remision_type, created_at, verified_at, verified_by, remision_items(id, reference, product_name, units, unit_cost)')
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
    queryKey: ['cargue-productos', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from('inventory_products') as any).select('id, reference, name, units_per_package').eq('active', true);
      if (error) throw error;
      return (data || []) as Array<ProductRef & ProductoEmpaque>;
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

  // Packing lists de los contenedores: piezas por paquete y peso por pieza.
  const { data: importItems = [] } = useQuery({
    queryKey: ['cargue-import-items', userId],
    enabled: !!userId,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      try {
        return await fetchAllPaged<ImportItemLite>((from, to) =>
          (supabase.from('import_items') as any)
            .select('reference, cantidad, bultos, unidad, peso_kg, created_at')
            .order('created_at', { ascending: true })
            .range(from, to), { maxRows: 20_000 });
      } catch {
        return [] as ImportItemLite[];
      }
    },
  });

  // Paquete y peso oficiales (Referencias por variante). Sin la migración: [].
  const variantesQ = useQuery({
    queryKey: ['cargue-variantes-empaque', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: () => cargarEmpaquesVariantes(),
  });
  const referencias = useMemo(() => variantesQ.data?.variantes ?? [], [variantesQ.data]);

  const remision = remQuery.data ?? null;
  const items = useMemo(() => remision?.remision_items ?? [], [remision]);
  const canon = useMemo(() => makeCanon(aliases), [aliases]);
  const lines = useMemo(() => buildCargueLines(items, canon), [items, canon]);

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

  return {
    remision, items, aliases, canon, lines, ubicaciones, products, importItems, referencias,
    referenciasSinMigracion: !!variantesQ.data?.faltaMigracion,
    loading: remQuery.isLoading, refetch: remQuery.refetch,
  };
}

// ═══════════════════════════ Conteo por paquetes ═══════════════════════════

export function useCargueConteo(params: {
  remisionId: string;
  practica: boolean;
  lines: CargueLine[];
  canon: (r: string) => string;
  aliases: Record<string, string>;
  items: ItemCierre[];
  empaques: Record<string, EmpaqueRef>;
  remision: RemisionCargue | null;
  orden: string[];
}) {
  const { remisionId, practica, lines, canon, aliases, items, empaques, remision, orden } = params;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const online = useOnline();

  // Estado COMPARTIDO: lo que ya subió (varios iPads suman al mismo pedido).
  const scansQuery = useQuery({
    queryKey: ['dispatch-scans', remisionId],
    enabled: !!remisionId,
    refetchInterval: !practica && online ? 3000 : false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('dispatch_scans').select(SCAN_COLS).eq('remision_id', remisionId);
      if (error) throw error;
      return (data || []) as DispatchEvent[];
    },
  });
  // En práctica no se mira el servidor: se empieza de cero sin tocar nada.
  const serverEvents = useMemo(() => (practica ? [] : scansQuery.data ?? []), [practica, scansQuery.data]);
  const eventosRegistro = scansQuery.data ?? [];

  const [local, setLocal] = useState<CargueLocalState>(() => loadLocal(remisionId, practica));
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => { saveLocal(remisionId, local, practica); }, [remisionId, local, practica]);

  const events = useMemo(() => mergeEvents(serverEvents, local.ops), [serverEvents, local.ops]);
  const cargado = useMemo(() => cargadoPorLinea(events, canon), [events, canon]);
  const paquetes = useMemo(() => cargadoEnPaquetes(events, canon), [events, canon]);
  const resumen = useMemo(() => resumenCargue(lines, cargado), [lines, cargado]);
  const operadores = useMemo(() => new Set(events.map((e) => e.operator_id).filter(Boolean)).size, [events]);

  const ordenadas = useMemo(() => {
    const pos: Record<string, number> = {};
    orden.forEach((k, i) => { pos[k] = i; });
    return [...lines].sort((a, b) => (pos[a.key] ?? 999) - (pos[b.key] ?? 999));
  }, [lines, orden]);

  const activeKey = useMemo(() => {
    if (local.activeKey && lines.some((l) => l.key === local.activeKey)) return local.activeKey;
    const sig = ordenadas.find((l) => (cargado[l.key] ?? 0) < l.pedido);
    return sig?.key ?? ordenadas[0]?.key ?? null;
  }, [local.activeKey, lines, ordenadas, cargado]);
  const activeLine: CargueLine | null = lines.find((l) => l.key === activeKey) ?? null;

  // ── Avisos ──
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

  const textoAvance = useCallback((key: string, unidades: number, paq: number) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return '';
    const plan = paquetesDe(line.pedido, empaques[key]?.porPaquete ?? null);
    return `${fmt(paq)} de ${fmt(plan.total)} paq · ${fmt(unidades)} de ${fmt(line.pedido)} und`;
  }, [lines, empaques]);

  /** Siguiente referencia del plan que todavía no está completa. */
  const siguienteDelPlan = useCallback((desde: string, cargadoNuevo: Record<string, number>) => {
    const i = ordenadas.findIndex((l) => l.key === desde);
    const resto = [...ordenadas.slice(i + 1), ...ordenadas.slice(0, Math.max(0, i))];
    return resto.find((l) => (cargadoNuevo[l.key] ?? 0) < l.pedido)?.key ?? null;
  }, [ordenadas]);

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

  /** Aviso + avance automático a la siguiente referencia del plan al completar. */
  const despuesDeSumar = useCallback((line: CargueLine, unidades: number) => {
    const r = evaluarConteo(lines, cargado, line.key, unidades);
    if (r.tipo === 'fuera') return;
    const paq = (paquetes[line.key]?.paquetes ?? 0) + (unidades > 0 ? 1 : -1);
    const avance = textoAvance(line.key, r.nuevo, Math.max(0, paq));
    if (r.tipo === 'sobrante') {
      showFlash('error', `${line.reference}: sobran ${fmt(r.nuevo - r.pedido)} und`, `${avance}. Bajá lo que sobra.`);
    } else if (r.tipo === 'completo') {
      const sig = siguienteDelPlan(line.key, { ...cargado, [line.key]: r.nuevo });
      const sigLine = sig ? lines.find((l) => l.key === sig) : null;
      showFlash('done', `${line.reference} completa`, sigLine ? `Sigue: ${sigLine.reference}` : 'Todo el pedido está cargado');
      if (sig) setLocal((cur) => ({ ...cur, activeKey: sig }));
    } else {
      showFlash('ok', `${line.reference} +1 paquete (${fmt(unidades)})`, avance);
    }
  }, [lines, cargado, paquetes, textoAvance, siguienteDelPlan, showFlash]);

  const handleScan = useCallback((raw: string) => {
    const parsed = parseScan(raw);
    if (!parsed) { showFlash('error', 'Código ilegible', 'Volvé a escanear la etiqueta.'); return; }
    const key = canon(parsed.reference);
    const line = lines.find((l) => l.key === key);
    if (!line) {
      const serial = (parsed.serial ?? '').trim().toLowerCase() || null;
      setLocal((cur) => (serial && cur.fuera.some((f) => (f.serial ?? '').toLowerCase() === serial)
        ? cur
        : { ...cur, fuera: [...cur.fuera, { id: newId(), reference: parsed.reference, quantity: parsed.quantity, at: new Date().toISOString(), serial }] }));
      showFlash('error', `${parsed.reference} NO va en este pedido`, 'Sacalo del camión y marcalo arriba como sacado.');
      return;
    }
    if (parsed.serial && serialYaContado(events, parsed.serial)) {
      showFlash('warn', 'Ese paquete ya se contó', `${parsed.serial} · no se sumó otra vez`);
      return;
    }
    addEvent({ reference: parsed.reference, quantity: parsed.quantity, serial: parsed.serial ?? null, location: parsed.location ?? null });
    setLocal((cur) => ({ ...cur, activeKey: key }));
    despuesDeSumar(line, parsed.quantity);
  }, [canon, lines, events, addEvent, despuesDeSumar, showFlash]);

  /** + 1 paquete: la medida estándar, o lo que falta si es el último incompleto. */
  const agregarPaquete = useCallback((key: string, unidades?: number) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const q = Math.round(unidades ?? siguientePaquete(line.pedido, cargado[key] ?? 0, empaques[key]?.porPaquete ?? null));
    if (q <= 0) return;
    addEvent({ reference: line.reference, quantity: q });
    setLocal((cur) => ({ ...cur, activeKey: key }));
    despuesDeSumar(line, q);
  }, [lines, cargado, empaques, addEvent, despuesDeSumar]);

  /** − 1 paquete: quita el último paquete contado de esa referencia. */
  const quitarPaquete = useCallback((key: string) => {
    const ultimos = events
      .filter((e) => canon(e.reference ?? '') === key && Number(e.quantity) > 0)
      .sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));
    const ultimo = ultimos[0];
    if (!ultimo) return;
    setLocal((cur) => ({ ...quitarEvento(cur, ultimo.id), activeKey: key }));
    const line = lines.find((l) => l.key === key);
    if (line) {
      const nuevo = Math.max(0, (cargado[key] ?? 0) - Number(ultimo.quantity));
      showFlash('warn', `${line.reference}: −1 paquete`, textoAvance(key, nuevo, Math.max(0, (paquetes[key]?.paquetes ?? 1) - 1)));
    }
  }, [events, canon, lines, cargado, paquetes, textoAvance, showFlash]);

  /** Escribir cuántos paquetes ESTÁNDAR van (agrega o quita hasta llegar). */
  const fijarPaquetes = useCallback((key: string, n: number) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const meta = Math.max(0, Math.round(n));
    const actuales = events
      .filter((e) => canon(e.reference ?? '') === key && Number(e.quantity) > 0)
      .sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));
    const tengo = paquetes[key]?.paquetes ?? 0;
    if (meta === tengo) return;
    if (meta < tengo) {
      setLocal((cur) => actuales.slice(0, tengo - meta).reduce((s, e) => quitarEvento(s, e.id), { ...cur, activeKey: key }));
      showFlash('warn', `${line.reference}: quedan ${fmt(meta)} paquetes`);
      return;
    }
    let unidades = cargado[key] ?? 0;
    const pp = empaques[key]?.porPaquete ?? null;
    const nuevos: DispatchEvent[] = [];
    for (let i = tengo; i < meta; i++) {
      const q = siguientePaquete(line.pedido, unidades, pp);
      unidades += q;
      nuevos.push({
        id: newId(), remision_id: remisionId, reference: line.reference, location: null, serial: null,
        quantity: q, scanned_at: new Date(Date.now() + i).toISOString(), operator_id: userId,
      });
    }
    setLocal((cur) => nuevos.reduce((s, e) => enqueueInsert(s, e), { ...cur, activeKey: key }));
    showFlash(unidades > line.pedido ? 'error' : unidades === line.pedido ? 'done' : 'ok',
      `${line.reference}: ${fmt(meta)} paquetes`, textoAvance(key, unidades, meta));
  }, [lines, events, canon, paquetes, cargado, empaques, remisionId, userId, textoAvance, showFlash]);

  const deshacer = useCallback(() => {
    const { state, undoneId } = undoLast(localRef.current);
    if (!undoneId) return;
    setLocal(state);
    showFlash('warn', 'Último conteo deshecho');
  }, [showFlash]);

  const setActive = useCallback((key: string) => setLocal((cur) => ({ ...cur, activeKey: key })), []);
  const resolverFuera = useCallback((id: string) => setLocal((cur) => ({ ...cur, fuera: cur.fuera.filter((f) => f.id !== id) })), []);

  // ── Subida en segundo plano ──
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

  // ── Cierre ──
  const cerrar = useCallback(async (ajustar: boolean, notaExtra: string): Promise<CierreResultado & { practica: boolean }> => {
    if (practica) {
      const plan = planearCierre(items, cargado, aliases, ajustar);
      return {
        number: remision?.number ?? '', date: remision?.date ?? '', beneficiary: remision?.beneficiary ?? '',
        items: itemsParaImprimir(plan.items), resumen: plan.resumen, ajustada: plan.ajustada, inventarioOk: true, practica: true,
      };
    }
    if (!userId) throw new Error('Sin sesión');
    await syncNow();
    const quedan = localRef.current.ops.length;
    if (quedan > 0) throw new Error(`Faltan ${quedan} conteo${quedan === 1 ? '' : 's'} por subir. Revisá el wifi y volvé a intentar.`);
    const res = await cerrarDespacho({ remisionId, cargado, aliases, ajustar, userId, operador: user?.email ?? '', notaExtra });
    clearLocal(remisionId, false);
    setLocal({ ops: [], mine: [], fuera: [], activeKey: null });
    qc.invalidateQueries({ queryKey: ['remisiones'] });
    qc.invalidateQueries({ queryKey: ['cargue-remision', remisionId] });
    qc.invalidateQueries({ queryKey: ['remision-cargues'] });
    if (res.ajustada) {
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    }
    return { ...res, practica: false };
  }, [practica, items, cargado, aliases, remision, userId, syncNow, remisionId, user?.email, qc]);

  const descartarPractica = useCallback(() => {
    clearLocal(remisionId, true);
    setLocal({ ops: [], mine: [], fuera: [], activeKey: null });
  }, [remisionId]);

  return {
    online, events, eventosRegistro, cargado, paquetes, resumen, operadores, ordenadas,
    activeKey, activeLine, setActive,
    fuera: local.fuera, resolverFuera,
    puedeDeshacer: local.mine.length > 0,
    flash, handleScan, agregarPaquete, quitarPaquete, fijarPaquetes, deshacer,
    pendientes, syncing, syncNow,
    cerrar, descartarPractica,
  };
}

export type CargueConteoApi = ReturnType<typeof useCargueConteo>;
