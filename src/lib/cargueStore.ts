import { supabase } from '@/integrations/supabase/client';
import type { CriterioCargue, SeguridadId } from '@/lib/cargueEmpaque';

// Guardado del PLAN de cargue y de las FOTOS del camión (tablas
// remision_cargues / remision_cargue_fotos y bucket privado "cargues",
// migración 20261112120000). Si la migración todavía no está aplicada, el plan
// se guarda en este equipo y las fotos no se pueden subir: la pantalla lo
// avisa en vez de romperse.

export interface PlanCargue {
  criterio: CriterioCargue;
  orden: string[];
  empaques: Record<string, number>;
  vehiculo: string | null;
  conductor: string | null;
  capacidad_kg: number | null;
}

export interface CargueRow extends PlanCargue {
  id: string;
  remision_id: string;
  seguridad: Partial<Record<SeguridadId, boolean>>;
  estado: 'planeado' | 'cargado' | string;
  paquetes: number | null;
  unidades: number | null;
  peso_kg: number | null;
  cerrado_at: string | null;
  cerrado_por: string | null;
  updated_at: string | null;
}

export interface FotoCargue {
  id: string;
  remision_id: string;
  storage_path: string;
  tomada_por: string | null;
  tomada_at: string;
  conteo_ia: number | null;
  conteo_ia_detalle: { confianza?: string; notas?: string; modelo?: string } | null;
}

export const PLAN_VACIO: PlanCargue = {
  criterio: 'remision', orden: [], empaques: {}, vehiculo: null, conductor: null, capacidad_kg: null,
};

const BUCKET = 'cargues';
const LOCAL_PREFIX = 'cargue:plan:v1:';

/** ¿El error es "esa tabla no existe" (migración sin aplicar)? */
export function esFaltaMigracion(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST204'
    || /does not exist|could not find the table|schema cache/i.test(String(e.message ?? ''));
}

function planLocal(remisionId: string): PlanCargue | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + remisionId);
    return raw ? { ...PLAN_VACIO, ...(JSON.parse(raw) as Partial<PlanCargue>) } : null;
  } catch { return null; }
}

export async function cargarCargue(remisionId: string): Promise<{ cargue: CargueRow | null; local: PlanCargue | null; faltaMigracion: boolean }> {
  const { data, error } = await (supabase as any)
    .from('remision_cargues')
    .select('*')
    .eq('remision_id', remisionId)
    .maybeSingle();
  if (error) {
    if (esFaltaMigracion(error)) return { cargue: null, local: planLocal(remisionId), faltaMigracion: true };
    throw error;
  }
  return { cargue: (data ?? null) as CargueRow | null, local: null, faltaMigracion: false };
}

export async function guardarPlan(remisionId: string, plan: PlanCargue, userId: string): Promise<{ guardadoLocal: boolean }> {
  const row = {
    remision_id: remisionId,
    user_id: userId, // el trigger lo pasa al dueño de la cuenta
    criterio: plan.criterio,
    orden: plan.orden,
    empaques: plan.empaques,
    vehiculo: plan.vehiculo?.trim() || null,
    conductor: plan.conductor?.trim() || null,
    capacidad_kg: plan.capacidad_kg && plan.capacidad_kg > 0 ? plan.capacidad_kg : null,
    planeado_por: userId,
  };
  const { error } = await (supabase as any).from('remision_cargues').upsert(row, { onConflict: 'remision_id' });
  if (error) {
    if (!esFaltaMigracion(error)) throw error;
    try { localStorage.setItem(LOCAL_PREFIX + remisionId, JSON.stringify(plan)); } catch { /* ignore */ }
    return { guardadoLocal: true };
  }
  return { guardadoLocal: false };
}

export async function marcarCargado(remisionId: string, datos: {
  userId: string;
  plan: PlanCargue;
  seguridad: Partial<Record<SeguridadId, boolean>>;
  paquetes: number;
  unidades: number;
  pesoKg: number | null;
}): Promise<void> {
  const { error } = await (supabase as any).from('remision_cargues').upsert({
    remision_id: remisionId,
    user_id: datos.userId,
    criterio: datos.plan.criterio,
    orden: datos.plan.orden,
    empaques: datos.plan.empaques,
    vehiculo: datos.plan.vehiculo?.trim() || null,
    conductor: datos.plan.conductor?.trim() || null,
    capacidad_kg: datos.plan.capacidad_kg && datos.plan.capacidad_kg > 0 ? datos.plan.capacidad_kg : null,
    seguridad: datos.seguridad,
    estado: 'cargado',
    paquetes: datos.paquetes,
    unidades: datos.unidades,
    peso_kg: datos.pesoKg,
    cerrado_por: datos.userId,
    cerrado_at: new Date().toISOString(),
  }, { onConflict: 'remision_id' });
  if (error && !esFaltaMigracion(error)) throw error;
}

export async function listarFotos(remisionId: string): Promise<{ fotos: FotoCargue[]; faltaMigracion: boolean }> {
  const { data, error } = await (supabase as any)
    .from('remision_cargue_fotos')
    .select('id, remision_id, storage_path, tomada_por, tomada_at, conteo_ia, conteo_ia_detalle')
    .eq('remision_id', remisionId)
    .order('tomada_at', { ascending: true });
  if (error) {
    if (esFaltaMigracion(error)) return { fotos: [], faltaMigracion: true };
    throw error;
  }
  return { fotos: (data ?? []) as FotoCargue[], faltaMigracion: false };
}

function nuevoId(): string {
  try { if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID(); } catch { /* ignore */ }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Achica la foto antes de subirla (1600 px y JPEG): las fotos del iPad pesan
 * 3-5 MB y el wifi de bodega es lento. Si el navegador no puede, sube la
 * original.
 */
export async function comprimirFoto(file: File, maxLado = 1600, calidad = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', calidad));
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function subirFoto(params: { ownerId: string; remisionId: string; userId: string; file: File }): Promise<FotoCargue> {
  const blob = await comprimirFoto(params.file);
  const path = `${params.ownerId}/${params.remisionId}/${nuevoId()}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await (supabase as any)
    .from('remision_cargue_fotos')
    .insert({ remision_id: params.remisionId, user_id: params.userId, storage_path: path, tomada_por: params.userId })
    .select('id, remision_id, storage_path, tomada_por, tomada_at, conteo_ia, conteo_ia_detalle')
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw error;
  }
  return data as FotoCargue;
}

export async function borrarFoto(foto: Pick<FotoCargue, 'id' | 'storage_path'>): Promise<void> {
  const { error } = await (supabase as any).from('remision_cargue_fotos').delete().eq('id', foto.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([foto.storage_path]).catch(() => undefined);
}

/** URLs firmadas (1 hora) para mostrar las fotos; objeto plano path → url. */
export async function urlsFirmadas(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

export interface ConteoIA { paquetes: number; confianza: string; notas: string; modelo?: string }

export async function contarPaquetesIA(fotoId: string): Promise<ConteoIA> {
  const { data, error } = await supabase.functions.invoke('contar-paquetes-cargue', { body: { foto_id: fotoId } });
  if (error) {
    // El cuerpo del error trae el mensaje para el usuario.
    let msg = 'No se pudo contar con IA. Revisá que la función esté publicada.';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) msg = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as ConteoIA;
}

// ─── Búsqueda para reclamos ───────────────────────────────────────────────

export interface ResultadoBusqueda {
  remision_id: string;
  number: string;
  beneficiary: string | null;
  date: string;
  status: string;
  cargue: Pick<CargueRow, 'estado' | 'paquetes' | 'unidades' | 'cerrado_at' | 'vehiculo' | 'conductor'> | null;
  fotos: number;
  /** Paquetes con serial que coinciden con lo buscado (trazabilidad por etiqueta). */
  seriales: { serial: string; reference: string; quantity: number; scanned_at: string }[];
  /** Referencias de la remisión que coinciden con lo buscado. */
  refs: string[];
}

/**
 * Busca cargues por cliente, número de remisión, referencia o serial de
 * paquete. Pensado para un reclamo: "el cliente dice que le llegaron 18
 * paquetes de PC635-3" → aparece la remisión, la foto y quién cargó.
 */
export async function buscarCargues(texto: string): Promise<ResultadoBusqueda[]> {
  const q = texto.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_,()]/g, '')}%`;

  const [porRem, porItem, porSerial] = await Promise.all([
    (supabase.from('remisiones') as any)
      .select('id, number, beneficiary, date, status')
      .eq('remision_type', 'venta')
      .or(`number.ilike.${like},beneficiary.ilike.${like}`)
      .order('date', { ascending: false })
      .limit(30),
    (supabase.from('remision_items') as any)
      .select('remision_id, reference')
      .ilike('reference', like)
      .limit(200),
    (supabase as any)
      .from('dispatch_scans')
      .select('remision_id, serial, reference, quantity, scanned_at')
      .ilike('serial', like)
      .limit(50),
  ]);
  if (porRem.error) throw porRem.error;

  const refsPorRem: Record<string, string[]> = {};
  for (const it of (porItem.error ? [] : porItem.data ?? []) as { remision_id: string; reference: string }[]) {
    const arr = refsPorRem[it.remision_id] ?? (refsPorRem[it.remision_id] = []);
    if (!arr.includes(it.reference)) arr.push(it.reference);
  }
  type SerialRow = { remision_id: string; serial: string; reference: string; quantity: number; scanned_at: string };
  const serialesPorRem: Record<string, ResultadoBusqueda['seriales']> = {};
  for (const row of (porSerial.error ? [] : porSerial.data ?? []) as SerialRow[]) {
    const arr = serialesPorRem[row.remision_id] ?? (serialesPorRem[row.remision_id] = []);
    arr.push({ serial: row.serial, reference: row.reference, quantity: Number(row.quantity) || 0, scanned_at: row.scanned_at });
  }

  const ids = Array.from(new Set([
    ...((porRem.data ?? []) as { id: string }[]).map((r) => r.id),
    ...Object.keys(refsPorRem),
    ...Object.keys(serialesPorRem),
  ])).slice(0, 40);
  if (ids.length === 0) return [];

  const [rems, cargues, fotos] = await Promise.all([
    (supabase.from('remisiones') as any).select('id, number, beneficiary, date, status, remision_type').in('id', ids),
    (supabase as any).from('remision_cargues').select('remision_id, estado, paquetes, unidades, cerrado_at, vehiculo, conductor').in('remision_id', ids),
    (supabase as any).from('remision_cargue_fotos').select('remision_id').in('remision_id', ids),
  ]);
  if (rems.error) throw rems.error;
  const cargueDe: Record<string, ResultadoBusqueda['cargue']> = {};
  for (const c of (cargues.error ? [] : cargues.data ?? []) as (NonNullable<ResultadoBusqueda['cargue']> & { remision_id: string })[]) cargueDe[c.remision_id] = c;
  const fotosDe: Record<string, number> = {};
  for (const f of (fotos.error ? [] : fotos.data ?? []) as { remision_id: string }[]) fotosDe[f.remision_id] = (fotosDe[f.remision_id] ?? 0) + 1;

  return ((rems.data ?? []) as { id: string; number: string; beneficiary: string | null; date: string; status: string; remision_type: string }[])
    .filter((r) => r.remision_type === 'venta')
    .map((r) => ({
      remision_id: r.id,
      number: r.number,
      beneficiary: r.beneficiary,
      date: r.date,
      status: r.status,
      cargue: cargueDe[r.id] ?? null,
      fotos: fotosDe[r.id] ?? 0,
      seriales: serialesPorRem[r.id] ?? [],
      refs: refsPorRem[r.id] ?? [],
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
