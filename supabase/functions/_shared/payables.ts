// ============================================================================
// FUENTE ÚNICA DE CUENTAS POR PAGAR — versión Deno
// ============================================================================
// Lo que le debés a tus proveedores: saldo REAL de cada factura de compra.
//
//   saldo = total − pagado − retenciones (reteica + autoretefuente)
//   pagado = transactions.invoice_id + invoice_transaction_matches
//
// Excluye facturas anuladas totalmente por NC. Antes vivía solo en el MCP
// (accounts_payable) y el consejo del CFO sumaba el TOTAL de las facturas de
// compra del año sin restar pagos: decía $327M cuando se debían $38M
// (auditoría 2026-11-12). Ahora ambos leen de acá.

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

const PAGE = 1000;
const IN_CHUNK = 200;

export interface SharedPayable {
  id: string;
  supplier: string;
  issue_date: string;
  due_date: string | null;
  dias_credito: number | null;
  total_amount: number;
  paid: number;
  retenciones: number;
  saldo: number;
  /** Días vencida hoy (due_date → dias_credito → issue_date). ≤ 0 = al día. */
  days_overdue: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Retenciones de una factura de compra: reteica + autoretefuente. */
export function invoiceRetencionesCompra(inv: Record<string, unknown>): number {
  return Math.abs(Number(inv.reteica_amount ?? 0)) + Math.abs(Number(inv.autoretefuente_amount ?? 0));
}

export function payableDaysOverdue(
  inv: { issue_date: string; due_date: string | null; dias_credito: number | null },
  today: Date,
): number {
  const issue = new Date(inv.issue_date);
  let venc = issue;
  if (inv.due_date) venc = new Date(inv.due_date);
  else if (inv.dias_credito) {
    venc = new Date(issue);
    venc.setDate(venc.getDate() + inv.dias_credito);
  }
  return Math.floor((today.getTime() - venc.getTime()) / 86400000);
}

export async function computePayables(
  db: Db,
  userId: string,
  opts: { from?: string; to?: string; today?: Date } = {},
): Promise<SharedPayable[]> {
  // PostgREST corta en 1000 filas sin avisar: paginamos.
  const invoices: Record<string, unknown>[] = [];
  for (let a = 0; ; a += PAGE) {
    let q = db.from("invoices")
      .select("id, counterparty_name, issue_date, due_date, dias_credito, total_amount, reteica_amount, autoretefuente_amount, void_type")
      .eq("user_id", userId)
      .eq("type", "compra")
      .or("void_type.is.null,void_type.eq.partial");
    if (opts.from) q = q.gte("issue_date", opts.from);
    if (opts.to) q = q.lte("issue_date", opts.to);
    const { data, error } = await q.order("id").range(a, a + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    invoices.push(...rows);
    if (rows.length < PAGE) break;
  }
  if (invoices.length === 0) return [];

  const paidById: Record<string, number> = {};
  const addPaid = (id: unknown, amt: unknown) => {
    if (!id) return;
    const k = id as string;
    paidById[k] = (paidById[k] ?? 0) + Math.abs(Number(amt ?? 0));
  };
  const ids = invoices.map((i) => i.id as string);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const [directRes, matchRes] = await Promise.all([
      db.from("transactions").select("invoice_id, amount").eq("user_id", userId).is("deleted_at", null).in("invoice_id", chunk),
      db.from("invoice_transaction_matches").select("invoice_id, matched_amount").in("invoice_id", chunk),
    ]);
    if (directRes.error) throw new Error(directRes.error.message);
    if (matchRes.error) throw new Error(matchRes.error.message);
    for (const r of (directRes.data ?? []) as Record<string, unknown>[]) addPaid(r.invoice_id, r.amount);
    for (const r of (matchRes.data ?? []) as Record<string, unknown>[]) addPaid(r.invoice_id, r.matched_amount);
  }

  const today = opts.today ?? new Date();
  return invoices.map((i) => {
    const total = Number(i.total_amount ?? 0);
    const paid = paidById[i.id as string] ?? 0;
    const retenciones = invoiceRetencionesCompra(i);
    const issue_date = i.issue_date as string;
    const due_date = (i.due_date as string | null) ?? null;
    const dias_credito = (i.dias_credito as number | null) ?? null;
    return {
      id: i.id as string,
      supplier: (i.counterparty_name as string) ?? "(sin nombre)",
      issue_date,
      due_date,
      dias_credito,
      total_amount: round2(total),
      paid: round2(paid),
      retenciones: round2(retenciones),
      saldo: round2(Math.max(0, total - paid - retenciones)),
      days_overdue: payableDaysOverdue({ issue_date, due_date, dias_credito }, today),
    };
  });
}
