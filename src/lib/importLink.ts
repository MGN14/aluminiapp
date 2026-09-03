/**
 * Vinculación transacción bancaria ↔ abono de importación desde Conciliación
 * (Nico 2026-09-03: "si en conciliación dije que era para proveedores y hay
 * un giro al exterior, debe poderse conciliar de una vez al contenedor").
 *
 * Mismas protecciones que lib/creditLink.ts (lecciones del doble descuento):
 *   1. Si la transacción YA respalda un abono (de CUALQUIER contenedor), no
 *      se inserta otro — el índice único import_payments_transaction_unique
 *      lo respalda a nivel de datos.
 *   2. Si ya existe un abono MANUAL del mismo contenedor que es el mismo
 *      giro (COP ±2%, fecha ±20 días), se ADOPTA (hereda transaction_id) en
 *      vez de duplicar — el caso "registré el abono en Importaciones y
 *      después concilié el extracto".
 *   3. Solo si no hay nada previo se crea el abono: USD = COP ÷ TRM del día
 *      del giro (igual que el formulario de Importaciones).
 */
import { supabase } from '@/integrations/supabase/client';
import { fetchTrmForDate } from '@/hooks/useImportPayments';

export const IMPORT_NOTE_MARKER_REGEX = /\[Importación - [^\]]+\]/g;

/** Extrae la etiqueta del contenedor del marcador `[Importación - X]`. */
export function parseImportNameFromNotes(notes: string | null | undefined): string | null {
  const m = (notes ?? '').match(/\[Importación - ([^\]]+)\]/);
  return m ? m[1] : null;
}

/** Mensaje legible de CUALQUIER error — los PostgrestError de Supabase son
 *  objetos planos, no instancias de Error (lección del "Error desconocido"). */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const partes = [e.message, e.details, e.hint, e.code ? `(${e.code})` : null].filter(Boolean);
    if (partes.length) return partes.join(' — ');
  }
  return String(err);
}

/** Ventanas para reconocer que un abono manual y un giro son EL MISMO pago. */
const ADOPT_MAX_DAYS = 20;
const ADOPT_COP_TOLERANCE = 0.02;

export interface ImportLinkParams {
  userId: string;
  importId: string;
  transactionId: string;
  /** Fecha del giro en el extracto (YYYY-MM-DD). */
  txDate: string;
  /** COP del giro, en valor absoluto. */
  txCopAbs: number;
}

export type ImportLinkResult =
  | { outcome: 'created'; usd: number; trm: number }
  | { outcome: 'adopted'; manualFecha: string; manualUsd: number }
  | { outcome: 'already_linked' };

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function linkImportPayment(p: ImportLinkParams): Promise<ImportLinkResult> {
  // 1. ¿Este giro ya respalda un abono? (de este o de OTRO contenedor)
  const { data: existing, error: exErr } = await (supabase.from('import_payments' as never) as any)
    .select('id')
    .eq('transaction_id', p.transactionId)
    .limit(1);
  if (exErr) throw exErr;
  if (existing?.length) return { outcome: 'already_linked' };

  // 2. ¿Hay un abono manual de ESTE contenedor que sea este mismo giro?
  //    Match por COP (amount_cop es columna generada usd×trm) — no depende
  //    de que haya TRM cargada. Se conservan los montos que Nico tipeó.
  const { data: manuals, error: mErr } = await (supabase.from('import_payments' as never) as any)
    .select('id, fecha, amount_usd, amount_cop')
    .eq('import_id', p.importId)
    .is('transaction_id', null)
    .gte('fecha', shiftDate(p.txDate, -ADOPT_MAX_DAYS))
    .lte('fecha', shiftDate(p.txDate, ADOPT_MAX_DAYS));
  if (mErr) throw mErr;

  const candidates = ((manuals ?? []) as Array<{ id: string; fecha: string; amount_usd: number; amount_cop: number }>)
    .filter((m) => Math.abs(Number(m.amount_cop) - p.txCopAbs) <= Math.max(50_000, p.txCopAbs * ADOPT_COP_TOLERANCE))
    .sort((a, b) => {
      const da = Math.abs(new Date(a.fecha + 'T12:00:00').getTime() - new Date(p.txDate + 'T12:00:00').getTime());
      const db = Math.abs(new Date(b.fecha + 'T12:00:00').getTime() - new Date(p.txDate + 'T12:00:00').getTime());
      if (da !== db) return da - db;
      return Math.abs(Number(a.amount_cop) - p.txCopAbs) - Math.abs(Number(b.amount_cop) - p.txCopAbs);
    });

  if (candidates.length > 0) {
    const best = candidates[0];
    const { error: upErr } = await (supabase.from('import_payments' as never) as any)
      .update({ transaction_id: p.transactionId })
      .eq('id', best.id);
    if (upErr) throw upErr;
    return { outcome: 'adopted', manualFecha: best.fecha, manualUsd: Number(best.amount_usd) };
  }

  // 3. Crear el abono desde el extracto: USD = COP ÷ TRM del día del giro.
  const trm = await fetchTrmForDate(p.txDate);
  if (!trm || trm <= 0) {
    throw new Error(`No hay TRM cargada para ${p.txDate} — registrá el abono desde Importaciones con TRM manual.`);
  }
  const usd = Math.round((p.txCopAbs / trm) * 100) / 100;
  const { error: insErr } = await (supabase.from('import_payments' as never) as any).insert({
    user_id: p.userId,
    import_id: p.importId,
    fecha: p.txDate,
    amount_usd: usd,
    trm,
    tipo: 'parcial',
    notes: 'Conciliado desde extracto',
    transaction_id: p.transactionId,
  });
  if (insErr) {
    // Índice único sobre transaction_id: otro clic ganó la carrera.
    if ((insErr as { code?: string }).code === '23505') return { outcome: 'already_linked' };
    throw insErr;
  }
  return { outcome: 'created', usd, trm };
}

/**
 * Desvincula el abono asociado a una transacción (la X del chip).
 * - Abono creado POR la conciliación ("Conciliado desde extracto") → se borra.
 * - Abono manual adoptado → se conserva y solo pierde el vínculo.
 */
export async function unlinkImportPayment(
  transactionId: string,
): Promise<'deleted' | 'kept_manual' | null> {
  const { data, error } = await (supabase.from('import_payments' as never) as any)
    .select('id, notes')
    .eq('transaction_id', transactionId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ id: string; notes: string | null }>;
  if (!rows.length) return null;

  let result: 'deleted' | 'kept_manual' = 'kept_manual';
  for (const row of rows) {
    if ((row.notes ?? '').startsWith('Conciliado desde extracto')) {
      const { error: delErr } = await (supabase.from('import_payments' as never) as any)
        .delete()
        .eq('id', row.id);
      if (delErr) throw delErr;
      result = 'deleted';
    } else {
      const { error: upErr } = await (supabase.from('import_payments' as never) as any)
        .update({ transaction_id: null })
        .eq('id', row.id);
      if (upErr) throw upErr;
    }
  }
  return result;
}
