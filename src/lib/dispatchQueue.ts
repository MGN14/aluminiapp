// Cola local del cargue: que NO se pierda un conteo si se cae el wifi.
//
// Cada escaneo o ajuste se guarda PRIMERO en el iPad (localStorage) con un id
// generado acá, y se sube después a `dispatch_scans`. Como el id lo pone el
// dispositivo, reintentar un insert es idempotente: si el servidor ya lo tenía,
// responde "llave duplicada" y lo damos por subido. Recargar la página, cerrar
// Safari o quedarse sin señal no borra nada: la cola vive en el dispositivo
// hasta que el servidor la confirma.
//
// Los eventos son de suma (cantidad positiva o negativa), así que varios
// operarios pueden sumar al mismo pedido sin pisarse. Deshacer un escaneo con
// serial BORRA el evento (para que ese paquete se pueda volver a escanear).

export interface DispatchEvent {
  id: string;
  remision_id: string;
  reference: string;
  location: string | null;
  serial: string | null;
  quantity: number;
  scanned_at: string;
  operator_id: string | null;
}

export type QueueOp =
  | { kind: 'insert'; event: DispatchEvent }
  | { kind: 'delete'; id: string };

/** Referencia escaneada que NO va en el pedido: hay que sacarla del camión. */
export interface FueraItem {
  id: string;
  reference: string;
  quantity: number;
  at: string;
  /** Serial de la etiqueta: el mismo paquete escaneado dos veces no se repite. */
  serial?: string | null;
}

export interface CargueLocalState {
  ops: QueueOp[];
  /** ids de MIS eventos, en orden (para "Deshacer"). */
  mine: string[];
  fuera: FueraItem[];
  activeKey: string | null;
}

export const EMPTY_LOCAL: CargueLocalState = { ops: [], mine: [], fuera: [], activeKey: null };

const PREFIX_REAL = 'despacho:cargue:v1:';
const PREFIX_PRACTICA = 'despacho:practica:v1:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { length: number };

function storageKey(remisionId: string, practica: boolean) {
  return `${practica ? PREFIX_PRACTICA : PREFIX_REAL}${remisionId}`;
}

function defaultStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function loadLocal(remisionId: string, practica = false, storage: StorageLike | null = defaultStorage()): CargueLocalState {
  try {
    const raw = storage?.getItem(storageKey(remisionId, practica));
    if (!raw) return { ...EMPTY_LOCAL };
    const o = JSON.parse(raw) as Partial<CargueLocalState>;
    return {
      ops: Array.isArray(o.ops) ? o.ops : [],
      mine: Array.isArray(o.mine) ? o.mine : [],
      fuera: Array.isArray(o.fuera) ? o.fuera : [],
      activeKey: typeof o.activeKey === 'string' ? o.activeKey : null,
    };
  } catch {
    return { ...EMPTY_LOCAL };
  }
}

export function saveLocal(remisionId: string, state: CargueLocalState, practica = false, storage: StorageLike | null = defaultStorage()): void {
  try {
    const vacio = state.ops.length === 0 && state.mine.length === 0 && state.fuera.length === 0 && !state.activeKey;
    if (vacio) storage?.removeItem(storageKey(remisionId, practica));
    else storage?.setItem(storageKey(remisionId, practica), JSON.stringify(state));
  } catch { /* storage lleno o bloqueado: el conteo sigue en memoria */ }
}

export function clearLocal(remisionId: string, practica = false, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(storageKey(remisionId, practica)); } catch { /* ignore */ }
}

/** Remisiones (reales, no práctica) con conteos guardados en el iPad sin subir. */
export function pendientesPorRemision(storage: StorageLike | null = defaultStorage()): Record<string, number> {
  const out: Record<string, number> = {};
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith(PREFIX_REAL)) continue;
      const id = k.slice(PREFIX_REAL.length);
      const n = loadLocal(id, false, storage).ops.length;
      if (n > 0) out[id] = n;
    }
  } catch { /* ignore */ }
  return out;
}

/** Eventos efectivos = los del servidor + mis inserts sin subir − mis borrados sin subir. */
export function mergeEvents(server: DispatchEvent[], ops: QueueOp[]): DispatchEvent[] {
  const borrados: Record<string, true> = {};
  for (const op of ops) if (op.kind === 'delete') borrados[op.id] = true;
  const vistos: Record<string, true> = {};
  const out: DispatchEvent[] = [];
  for (const e of server) {
    if (borrados[e.id]) continue;
    vistos[e.id] = true;
    out.push(e);
  }
  for (const op of ops) {
    if (op.kind !== 'insert' || vistos[op.event.id] || borrados[op.event.id]) continue;
    vistos[op.event.id] = true;
    out.push(op.event);
  }
  return out;
}

export function enqueueInsert(state: CargueLocalState, event: DispatchEvent): CargueLocalState {
  return { ...state, ops: [...state.ops, { kind: 'insert', event }], mine: [...state.mine, event.id] };
}

/**
 * Deshace MI último evento: si todavía no subió, se saca de la cola; si ya
 * subió, se encola su borrado.
 */
export function undoLast(state: CargueLocalState): { state: CargueLocalState; undoneId: string | null } {
  if (state.mine.length === 0) return { state, undoneId: null };
  const id = state.mine[state.mine.length - 1];
  const mine = state.mine.slice(0, -1);
  const pendiente = state.ops.some((op) => op.kind === 'insert' && op.event.id === id);
  const ops = pendiente
    ? state.ops.filter((op) => !(op.kind === 'insert' && op.event.id === id))
    : [...state.ops, { kind: 'delete' as const, id }];
  return { state: { ...state, ops, mine }, undoneId: id };
}

/**
 * Quita UN evento puntual (p. ej. "−" = quitar el último paquete de una
 * referencia, aunque lo haya contado otro operario): si no había subido se
 * saca de la cola; si ya subió, se encola su borrado.
 */
export function quitarEvento(state: CargueLocalState, id: string): CargueLocalState {
  const pendiente = state.ops.some((op) => op.kind === 'insert' && op.event.id === id);
  const ops = pendiente
    ? state.ops.filter((op) => !(op.kind === 'insert' && op.event.id === id))
    : state.ops.some((op) => op.kind === 'delete' && op.id === id) ? state.ops : [...state.ops, { kind: 'delete' as const, id }];
  return { ...state, ops, mine: state.mine.filter((m) => m !== id) };
}

export interface SyncError { code?: string | null; message?: string | null }
export interface SyncClient {
  insert: (event: DispatchEvent) => Promise<{ error: SyncError | null }>;
  remove: (id: string) => Promise<{ error: SyncError | null }>;
}

export interface SyncResult {
  /** Operaciones confirmadas por el servidor (en el mismo formato de la cola). */
  done: QueueOp[];
  /** Escaneos rechazados porque ese paquete (serial) ya lo había contado otro. */
  serialRechazados: DispatchEvent[];
  /** Hubo un error de red/servidor: lo que quedó se reintenta después. */
  error: string | null;
}

const opId = (op: QueueOp) => (op.kind === 'insert' ? `i:${op.event.id}` : `d:${op.id}`);

/** Sube la cola EN ORDEN; se detiene en el primer error de red (se reintenta luego). */
export async function syncOps(ops: QueueOp[], client: SyncClient): Promise<SyncResult> {
  const done: QueueOp[] = [];
  const serialRechazados: DispatchEvent[] = [];
  for (const op of ops) {
    try {
      if (op.kind === 'insert') {
        const { error } = await client.insert(op.event);
        if (error) {
          const dup = error.code === '23505' || /duplicate|unique/i.test(String(error.message ?? ''));
          if (!dup) return { done, serialRechazados, error: String(error.message ?? 'Error al subir') };
          // Llave duplicada: o ya estaba subido (mismo id → OK), o ese serial lo
          // contó otro operario (índice único remision+serial → se descarta).
          if (/serial/i.test(String(error.message ?? '')) && op.event.serial) serialRechazados.push(op.event);
        }
      } else {
        const { error } = await client.remove(op.id);
        if (error) return { done, serialRechazados, error: String(error.message ?? 'Error al subir') };
      }
      done.push(op);
    } catch (e) {
      return { done, serialRechazados, error: e instanceof Error ? e.message : 'Sin conexión' };
    }
  }
  return { done, serialRechazados, error: null };
}

/**
 * Aplica el resultado de una subida a la cola ACTUAL (que pudo cambiar mientras
 * se subía): saca lo confirmado y, si el operario deshizo un evento que justo
 * se estaba subiendo, encola su borrado para que no quede en el servidor.
 */
export function aplicarResultadoSync(current: CargueLocalState, result: SyncResult): CargueLocalState {
  const hechos: Record<string, true> = {};
  for (const op of result.done) hechos[opId(op)] = true;
  const rechazados: Record<string, true> = {};
  for (const e of result.serialRechazados) rechazados[e.id] = true;

  const ops = current.ops.filter((op) => !hechos[opId(op)]);
  for (const op of result.done) {
    if (op.kind !== 'insert' || rechazados[op.event.id]) continue;
    const sigueEnCola = current.ops.some((o) => o.kind === 'insert' && o.event.id === op.event.id);
    if (!sigueEnCola && !current.mine.includes(op.event.id)) {
      // Se deshizo mientras subía → borrarlo también del servidor.
      ops.push({ kind: 'delete', id: op.event.id });
    }
  }
  const mine = current.mine.filter((id) => !rechazados[id]);
  return { ...current, ops, mine };
}
