import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLocal, saveLocal, clearLocal, pendientesPorRemision, mergeEvents, enqueueInsert, undoLast, quitarEvento,
  syncOps, aplicarResultadoSync, EMPTY_LOCAL,
  type DispatchEvent, type SyncClient, type CargueLocalState,
} from './dispatchQueue';

const ev = (id: string, extra: Partial<DispatchEvent> = {}): DispatchEvent => ({
  id, remision_id: 'r1', reference: 'PC635-3', location: null, serial: null,
  quantity: 1, scanned_at: '2026-11-11T15:00:00Z', operator_id: 'u1', ...extra,
});

function fakeClient(opts: { failAfter?: number; dupSerial?: string[]; dupId?: string[] } = {}) {
  const inserted: string[] = [];
  const removed: string[] = [];
  let calls = 0;
  const client: SyncClient = {
    insert: async (e) => {
      calls++;
      if (opts.failAfter != null && calls > opts.failAfter) return { error: { message: 'TypeError: Failed to fetch' } };
      if (opts.dupSerial?.includes(e.id)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "dispatch_scans_serial_uq"' } };
      if (opts.dupId?.includes(e.id)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "dispatch_scans_pkey"' } };
      inserted.push(e.id);
      return { error: null };
    },
    remove: async (id) => {
      calls++;
      if (opts.failAfter != null && calls > opts.failAfter) return { error: { message: 'Failed to fetch' } };
      removed.push(id);
      return { error: null };
    },
  };
  return { client, inserted, removed };
}

// Storage en memoria (el localStorage de jsdom en este setup no es confiable).
class MemStorage {
  private m: Record<string, string> = {};
  get length() { return Object.keys(this.m).length; }
  key(i: number) { return Object.keys(this.m)[i] ?? null; }
  getItem(k: string) { return k in this.m ? this.m[k] : null; }
  setItem(k: string, v: string) { this.m[k] = String(v); }
  removeItem(k: string) { delete this.m[k]; }
}

describe('persistencia local', () => {
  let st: MemStorage;
  beforeEach(() => { st = new MemStorage(); });

  it('guarda y recupera la cola de una remisión', () => {
    const s = enqueueInsert({ ...EMPTY_LOCAL }, ev('a'));
    saveLocal('r1', { ...s, activeKey: 'pc635-3' }, false, st);
    const back = loadLocal('r1', false, st);
    expect(back.ops).toHaveLength(1);
    expect(back.mine).toEqual(['a']);
    expect(back.activeKey).toBe('pc635-3');
  });

  it('la práctica vive aparte y no cuenta como pendiente por subir', () => {
    saveLocal('r1', enqueueInsert({ ...EMPTY_LOCAL }, ev('a')), true, st);
    saveLocal('r2', enqueueInsert({ ...EMPTY_LOCAL }, ev('b')), false, st);
    expect(loadLocal('r1', false, st).ops).toHaveLength(0);
    expect(loadLocal('r1', true, st).ops).toHaveLength(1);
    expect(pendientesPorRemision(st)).toEqual({ r2: 1 });
  });

  it('un estado vacío borra la llave; clearLocal también', () => {
    saveLocal('r1', enqueueInsert({ ...EMPTY_LOCAL }, ev('a')), false, st);
    saveLocal('r1', { ...EMPTY_LOCAL }, false, st);
    expect(st.length).toBe(0);
    saveLocal('r1', enqueueInsert({ ...EMPTY_LOCAL }, ev('a')), false, st);
    clearLocal('r1', false, st);
    expect(st.length).toBe(0);
  });

  it('JSON roto no tumba la pantalla', () => {
    st.setItem('despacho:cargue:v1:r1', '{roto');
    expect(loadLocal('r1', false, st)).toEqual(EMPTY_LOCAL);
  });
});

describe('mergeEvents', () => {
  it('suma lo del servidor con lo pendiente sin duplicar y respeta borrados', () => {
    const server = [ev('a'), ev('b')];
    const merged = mergeEvents(server, [
      { kind: 'insert', event: ev('b') },
      { kind: 'insert', event: ev('c') },
      { kind: 'delete', id: 'a' },
    ]);
    expect(merged.map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('undoLast', () => {
  it('si no había subido, lo saca de la cola', () => {
    const s = enqueueInsert(enqueueInsert({ ...EMPTY_LOCAL }, ev('a')), ev('b'));
    const { state, undoneId } = undoLast(s);
    expect(undoneId).toBe('b');
    expect(state.ops.map((o) => (o.kind === 'insert' ? o.event.id : o.id))).toEqual(['a']);
    expect(state.mine).toEqual(['a']);
  });
  it('si ya había subido, encola su borrado', () => {
    const s: CargueLocalState = { ...EMPTY_LOCAL, mine: ['a'] };
    const { state } = undoLast(s);
    expect(state.ops).toEqual([{ kind: 'delete', id: 'a' }]);
    expect(state.mine).toEqual([]);
  });
  it('sin eventos propios no hace nada', () => {
    expect(undoLast({ ...EMPTY_LOCAL }).undoneId).toBeNull();
  });
});

describe('quitarEvento', () => {
  it('saca de la cola lo que no había subido', () => {
    const s = enqueueInsert(enqueueInsert({ ...EMPTY_LOCAL }, ev('a')), ev('b'));
    const out = quitarEvento(s, 'a');
    expect(out.ops.map((o) => (o.kind === 'insert' ? o.event.id : o.id))).toEqual(['b']);
    expect(out.mine).toEqual(['b']);
  });
  it('encola el borrado de lo que ya subió (una sola vez)', () => {
    const s = quitarEvento(quitarEvento({ ...EMPTY_LOCAL }, 'x'), 'x');
    expect(s.ops).toEqual([{ kind: 'delete', id: 'x' }]);
  });
});

describe('syncOps', () => {
  it('sube en orden y confirma todo', async () => {
    const { client, inserted, removed } = fakeClient();
    const r = await syncOps([{ kind: 'insert', event: ev('a') }, { kind: 'delete', id: 'z' }], client);
    expect(r.error).toBeNull();
    expect(r.done).toHaveLength(2);
    expect(inserted).toEqual(['a']);
    expect(removed).toEqual(['z']);
  });

  it('se detiene sin conexión y deja el resto para después', async () => {
    const { client } = fakeClient({ failAfter: 1 });
    const r = await syncOps([{ kind: 'insert', event: ev('a') }, { kind: 'insert', event: ev('b') }, { kind: 'insert', event: ev('c') }], client);
    expect(r.error).toMatch(/fetch/i);
    expect(r.done).toHaveLength(1);
  });

  it('reintento de algo que ya estaba subido (mismo id) cuenta como hecho', async () => {
    const { client } = fakeClient({ dupId: ['a'] });
    const r = await syncOps([{ kind: 'insert', event: ev('a') }], client);
    expect(r.error).toBeNull();
    expect(r.done).toHaveLength(1);
    expect(r.serialRechazados).toEqual([]);
  });

  it('paquete que ya contó otro operario se rechaza sin frenar la cola', async () => {
    const { client, inserted } = fakeClient({ dupSerial: ['a'] });
    const r = await syncOps([{ kind: 'insert', event: ev('a', { serial: 'S-1' }) }, { kind: 'insert', event: ev('b') }], client);
    expect(r.error).toBeNull();
    expect(r.serialRechazados.map((e) => e.id)).toEqual(['a']);
    expect(inserted).toEqual(['b']);
  });

  it('un throw (sin red) también se trata como pausa', async () => {
    const client: SyncClient = { insert: async () => { throw new Error('Load failed'); }, remove: async () => ({ error: null }) };
    const r = await syncOps([{ kind: 'insert', event: ev('a') }], client);
    expect(r.error).toBe('Load failed');
    expect(r.done).toEqual([]);
  });
});

describe('aplicarResultadoSync', () => {
  it('saca lo confirmado y deja lo que entró mientras subía', () => {
    const antes = enqueueInsert({ ...EMPTY_LOCAL }, ev('a'));
    const durante = enqueueInsert(antes, ev('b'));
    const after = aplicarResultadoSync(durante, { done: [{ kind: 'insert', event: ev('a') }], serialRechazados: [], error: null });
    expect(after.ops.map((o) => (o.kind === 'insert' ? o.event.id : o.id))).toEqual(['b']);
    expect(after.mine).toEqual(['a', 'b']);
  });

  it('si se deshizo mientras subía, encola el borrado en el servidor', () => {
    const antes = enqueueInsert({ ...EMPTY_LOCAL }, ev('a'));
    const deshecho = undoLast(antes).state;
    const after = aplicarResultadoSync(deshecho, { done: [{ kind: 'insert', event: ev('a') }], serialRechazados: [], error: null });
    expect(after.ops).toEqual([{ kind: 'delete', id: 'a' }]);
  });

  it('los rechazados por serial salen de "mis eventos"', () => {
    const s = enqueueInsert({ ...EMPTY_LOCAL }, ev('a', { serial: 'S-1' }));
    const after = aplicarResultadoSync(s, { done: [{ kind: 'insert', event: ev('a', { serial: 'S-1' }) }], serialRechazados: [ev('a', { serial: 'S-1' })], error: null });
    expect(after.ops).toEqual([]);
    expect(after.mine).toEqual([]);
  });
});
