/**
 * Vinculación transacción bancaria ↔ pago de crédito, con dos protecciones
 * que antes no existían (bug doble descuento, Nico 2026-09-01):
 *
 * 1. Si la transacción YA respalda un pago del crédito, no se inserta otro
 *    (el doble clic sobre "Pendiente" creaba un pago por clic y marcaba
 *    cuotas futuras como pagadas).
 * 2. Si ya existe un pago MANUAL que es el mismo débito (registrado a mano
 *    en /creditos antes de conciliar el extracto), se ADOPTA ese pago
 *    (hereda el transaction_id) en vez de insertar uno nuevo — la cuota es
 *    una sola, no dos.
 *
 * Usado por los tres flujos de conciliación: TransactionRow (Transacciones),
 * PendingTransactionsTable (Dashboard) y VincularFacturaTxModal (Relación de
 * pagos).
 */
import { supabase } from '@/integrations/supabase/client';

/** Ventana para reconocer que un pago manual y un débito del extracto son
 *  EL MISMO pago: ±20 días (no cruza a la cuota del mes anterior/siguiente,
 *  que queda a ~30 días) y ±15% de monto (mismo margen que usan las
 *  sugerencias de match del módulo Créditos). */
const ADOPT_MAX_DAYS = 20;
const ADOPT_AMOUNT_TOLERANCE = 0.15;

export const CREDIT_NOTE_MARKER_REGEX = /\[Crédito - [^\]]+\]/g;

/** Extrae el nombre del crédito del marcador `[Crédito - X]` en las notas
 *  de una transacción, si existe. */
export function parseCreditNameFromNotes(notes: string | null | undefined): string | null {
  const m = (notes ?? '').match(/\[Crédito - ([^\]]+)\]/);
  return m ? m[1] : null;
}

export interface CreditLinkParams {
  userId: string;
  creditId: string;
  transactionId: string;
  /** Fecha del débito en el extracto (YYYY-MM-DD). */
  paymentDate: string;
  amountPaid: number;
  principalPaid: number;
  interestPaid: number;
  /** Saldo estimado del crédito después de este pago — solo se usa para
   *  marcar el crédito como saldado cuando se crea un pago NUEVO. */
  newBalance: number;
  notes?: string;
}

export type CreditLinkResult =
  | { outcome: 'created'; creditPaidOff: boolean }
  | { outcome: 'adopted'; manualPaymentDate: string; manualAmount: number }
  | { outcome: 'already_linked' };

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(a + 'T12:00:00').getTime() - new Date(b + 'T12:00:00').getTime()) / 86_400_000,
  );
}

export async function linkCreditPayment(p: CreditLinkParams): Promise<CreditLinkResult> {
  // 1. ¿Esta transacción ya respalda un pago? (doble clic / segunda pasada)
  const { data: existing, error: exErr } = await (supabase.from('credit_payments' as never) as any)
    .select('id')
    .eq('transaction_id', p.transactionId)
    .limit(1);
  if (exErr) throw exErr;
  if (existing?.length) return { outcome: 'already_linked' };

  // 2. ¿Hay un pago manual que sea este mismo débito? → adoptarlo. Se
  //    conservan los montos que el usuario tipeó (su registro manual es la
  //    fuente de verdad de capital/interés).
  const { data: manuals, error: mErr } = await (supabase.from('credit_payments' as never) as any)
    .select('id, payment_date, amount_paid')
    .eq('credit_id', p.creditId)
    .is('transaction_id', null)
    .eq('is_extra', false)
    .gte('payment_date', shiftDate(p.paymentDate, -ADOPT_MAX_DAYS))
    .lte('payment_date', shiftDate(p.paymentDate, ADOPT_MAX_DAYS));
  if (mErr) throw mErr;

  const candidates = ((manuals ?? []) as Array<{ id: string; payment_date: string; amount_paid: number }>)
    .filter((m) => Math.abs(Number(m.amount_paid) - p.amountPaid) <= p.amountPaid * ADOPT_AMOUNT_TOLERANCE)
    .sort((a, b) => {
      const da = Math.abs(daysBetween(a.payment_date, p.paymentDate));
      const db = Math.abs(daysBetween(b.payment_date, p.paymentDate));
      if (da !== db) return da - db;
      return (
        Math.abs(Number(a.amount_paid) - p.amountPaid) - Math.abs(Number(b.amount_paid) - p.amountPaid)
      );
    });

  if (candidates.length > 0) {
    const best = candidates[0];
    const { error: upErr } = await (supabase.from('credit_payments' as never) as any)
      .update({ transaction_id: p.transactionId })
      .eq('id', best.id);
    if (upErr) throw upErr;
    return { outcome: 'adopted', manualPaymentDate: best.payment_date, manualAmount: Number(best.amount_paid) };
  }

  // 3. No había nada previo → crear el pago desde el extracto.
  const { error: insErr } = await (supabase.from('credit_payments' as never) as any).insert({
    user_id: p.userId,
    credit_id: p.creditId,
    payment_date: p.paymentDate,
    amount_paid: p.amountPaid,
    principal_paid: p.principalPaid,
    interest_paid: p.interestPaid,
    is_extra: false,
    notes: p.notes ?? 'Conciliado desde extracto',
    transaction_id: p.transactionId,
  });
  if (insErr) {
    // Índice único sobre transaction_id: otro clic ganó la carrera.
    if ((insErr as { code?: string }).code === '23505') return { outcome: 'already_linked' };
    throw insErr;
  }

  let creditPaidOff = false;
  if (p.newBalance <= 0.5) {
    await (supabase.from('credits' as never) as any)
      .update({ status: 'paid' })
      .eq('id', p.creditId);
    creditPaidOff = true;
  }
  return { outcome: 'created', creditPaidOff };
}

/**
 * Desvincula el pago de crédito asociado a una transacción bancaria (la X
 * del chip de crédito en conciliación).
 * - Pago creado POR la conciliación ("Conciliado desde extracto") → se borra.
 * - Pago manual adoptado → se conserva y solo pierde el vínculo.
 * Si al borrar revive saldo en un crédito marcado "paid", vuelve a "active"
 * (mismo comportamiento que borrar el pago desde /creditos).
 */
export async function unlinkCreditPayment(
  transactionId: string,
): Promise<'deleted' | 'kept_manual' | null> {
  const { data, error } = await (supabase.from('credit_payments' as never) as any)
    .select('id, credit_id, notes')
    .eq('transaction_id', transactionId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ id: string; credit_id: string; notes: string | null }>;
  if (!rows.length) return null;

  let result: 'deleted' | 'kept_manual' = 'kept_manual';
  const touchedCredits = new Set<string>();
  for (const row of rows) {
    if ((row.notes ?? '').startsWith('Conciliado desde extracto')) {
      const { error: delErr } = await (supabase.from('credit_payments' as never) as any)
        .delete()
        .eq('id', row.id);
      if (delErr) throw delErr;
      result = 'deleted';
      touchedCredits.add(row.credit_id);
    } else {
      const { error: upErr } = await (supabase.from('credit_payments' as never) as any)
        .update({ transaction_id: null })
        .eq('id', row.id);
      if (upErr) throw upErr;
    }
  }

  // Revivir créditos que quedaron "paid" pero recuperaron saldo al borrar.
  for (const creditId of touchedCredits) {
    const [{ data: credit }, { data: pays }] = await Promise.all([
      (supabase.from('credits' as never) as any).select('id, principal, status').eq('id', creditId).maybeSingle(),
      (supabase.from('credit_payments' as never) as any).select('principal_paid').eq('credit_id', creditId),
    ]);
    if (!credit || credit.status !== 'paid') continue;
    const paid = ((pays ?? []) as Array<{ principal_paid: number }>).reduce(
      (s, r) => s + Number(r.principal_paid || 0),
      0,
    );
    if (Number(credit.principal) - paid > 0.5) {
      await (supabase.from('credits' as never) as any)
        .update({ status: 'active' })
        .eq('id', creditId);
    }
  }
  return result;
}
