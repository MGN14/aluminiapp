// ============================================================================
// FUENTE ÚNICA DE CARTERA — versión Deno (espejo de src/lib/clientReceivables.ts)
// ============================================================================
// Antes cada edge function calculaba "lo que debe el cliente" a su manera:
// score-collection-clients, weekly-collection-report, draft-collection-message
// y create-invoice-payment-link leían `invoices.balance_pending`, un campo que
// solo escribe siigo-sync y que NO baja al conciliar pagos en la app. Auditoría
// 2026-08-12: sobrestimaba la deuda en $164M y el link Wompi podía cobrarle a
// un cliente una factura que ya pagó.
//
// Esta es la MISMA fórmula que la pantalla de Cobranza (lib/clientReceivables):
//
//   total_a_cobrar = facturado (neto de NC parciales) + cxc_inicial
//   total_recibido = ingresos banco OPERATIVOS del cliente
//                  + efectivo con beneficiario (cash_movements)
//                  + anticipos (linked + unlinked)
//                  + retenciones explícitas
//   saldo_neto     = total_a_cobrar − total_recibido
//
// Por factura: `effective_pending` = saldo tras imputar TODO el crédito del
// cliente por FIFO (Art. 1653-1654 CC), reservando primero el cxc_inicial
// (la deuda más vieja se cubre primero).
//
// REGLA DE ORO: cualquier cambio acá se replica en src/lib/clientReceivables.ts
// (mismo patrón de copia espejo que ublInvoiceParser).

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

const PAID_EPSILON = 1;
const PAGE = 1000;

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+s\.?a\.?s\.?\s*$/i, "")
    .replace(/\s+ltda\.?\s*$/i, "")
    .replace(/\s+s\.?a\.?\s*$/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOperativo(nature: string | null | undefined): boolean {
  return !nature || nature === "operativo";
}

/** Retenciones de una factura de venta — espejo de src/lib/invoiceBalance.ts. */
export function invoiceRetencionesVenta(inv: Record<string, unknown>): number {
  const reteica = Math.abs(Number(inv.reteica_amount ?? 0));
  const autoretefuente = Math.abs(Number(inv.autoretefuente_amount ?? 0));
  let retefuente = 0;
  const savedRete = Number(inv.retefuente_cliente_amount ?? 0);
  const rawRate = inv.retefuente_cliente_rate as number | null | undefined;
  if (savedRete > 0) retefuente = savedRete;
  else if (rawRate !== null && rawRate !== undefined) {
    retefuente = Math.round(Number(inv.subtotal_base ?? 0) * Number(rawRate));
  }
  return retefuente + reteica + autoretefuente;
}

/** Trae TODAS las filas de un query paginando de a 1000 (PostgREST corta en
 *  1000 silenciosamente — auditoría H5). `build` recibe (from, to) y devuelve
 *  el query listo para await. */
// deno-lint-ignore no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface SharedInvoiceLine {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  dias_credito: number | null;
  /** total_amount − voided_amount (NC parciales descontadas — H10). */
  total_neto: number;
  retenciones_total: number;
  paid_direct: number;
  /** Saldo real post-FIFO. Este es EL número (pantalla, score, Wompi). */
  effective_pending: number;
  /** Días vencida hoy (due_date → dias_credito → issue_date). Negativo = no vence aún. */
  days_overdue: number;
  client_id: string;
  client_name: string;
  responsible_id: string | null;
}

export interface SharedClientReceivable {
  client_id: string;
  client_name: string;
  responsible_id: string | null;
  facturado_venta: number;
  cxc_inicial: number;
  cobrado_banco: number;
  cobrado_efectivo: number;
  anticipos_total: number;
  retenciones_total: number;
  saldo_neto: number;
  /** Σ balance_pending crudo de Siigo (para el cuadre app vs Siigo). */
  saldo_siigo: number;
  oldest_overdue_days: number;
  invoices_pendientes: SharedInvoiceLine[];
}

export interface SharedReceivablesResult {
  clients: SharedClientReceivable[];
  total_saldo_pendiente: number;
  total_saldo_a_favor: number;
  /** Ingresos operativos del año sin cliente atribuible (KPI de confianza). */
  sin_conciliar: { count: number; monto: number };
  invoiceById: Map<string, SharedInvoiceLine>;
}

function daysOverdue(inv: { issue_date: string; due_date: string | null; dias_credito: number | null }, today: Date): number {
  const issue = new Date(inv.issue_date);
  let venc = issue;
  if (inv.due_date) venc = new Date(inv.due_date);
  else if (inv.dias_credito && inv.dias_credito > 0) {
    venc = new Date(issue);
    venc.setDate(venc.getDate() + inv.dias_credito);
  }
  return Math.floor((today.getTime() - venc.getTime()) / 86400000);
}

export async function computeReceivables(db: Db, userId: string, year: number): Promise<SharedReceivablesResult> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const [responsibles, aliases, invoices, transactions, matches, initialDetails, initialMatches, cashIngresos] = await Promise.all([
    fetchAll<{ id: string; name: string }>((a, b) =>
      db.from("responsibles").select("id, name").eq("user_id", userId).range(a, b)),
    fetchAll<{ responsible_id: string; alias: string }>((a, b) =>
      db.from("responsible_aliases").select("responsible_id, alias").eq("user_id", userId).range(a, b)),
    fetchAll<Record<string, unknown>>((a, b) =>
      db.from("invoices")
        .select("id, invoice_number, counterparty_name, responsible_id, issue_date, due_date, dias_credito, total_amount, subtotal_base, retefuente_cliente_amount, retefuente_cliente_rate, reteica_amount, autoretefuente_amount, void_type, voided_amount, balance_pending")
        .eq("user_id", userId)
        .eq("type", "venta")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .or("void_type.is.null,void_type.eq.partial")
        .range(a, b)),
    fetchAll<Record<string, unknown>>((a, b) =>
      db.from("transactions")
        .select("id, invoice_id, responsible_id, amount, movement_nature")
        .eq("user_id", userId)
        .eq("type", "ingreso")
        .is("deleted_at", null)
        .gte("date", startDate)
        .lte("date", endDate)
        .range(a, b)),
    fetchAll<{ invoice_id: string; transaction_id: string; matched_amount: number }>((a, b) =>
      db.from("invoice_transaction_matches").select("invoice_id, transaction_id, matched_amount").eq("user_id", userId).range(a, b)),
    fetchAll<Record<string, unknown>>((a, b) =>
      db.from("initial_state_details").select("id, field_type, amount, invoice_id, responsible_id, responsible_name").eq("user_id", userId).range(a, b)),
    fetchAll<{ initial_state_detail_id: string; transaction_id: string }>((a, b) =>
      db.from("initial_balance_matches").select("initial_state_detail_id, transaction_id").eq("user_id", userId).range(a, b)),
    // Efectivo con beneficiario (H7): plata real del cliente que no pasó por
    // banco. Los promovidos desde Caja Menor se incluyen (acá NO se lee
    // petty_cash_movements, así que no hay doble conteo).
    fetchAll<{ responsible_id: string | null; amount: number }>((a, b) =>
      db.from("cash_movements")
        .select("responsible_id, amount")
        .eq("user_id", userId)
        .eq("type", "ingreso")
        .not("responsible_id", "is", null)
        .gte("date", startDate)
        .lte("date", endDate)
        .range(a, b)),
  ]);

  // 1. Canonicalización por aliases
  const canonicalOf = new Map<string, string>();
  responsibles.forEach((r) => canonicalOf.set(r.id, r.id));
  const respByNormName = new Map<string, string>();
  responsibles.forEach((r) => {
    const n = normalizeName(r.name);
    if (n) respByNormName.set(n, r.id);
  });
  for (const a of aliases) {
    const legacyId = respByNormName.get(normalizeName(a.alias));
    if (legacyId && legacyId !== a.responsible_id) canonicalOf.set(legacyId, a.responsible_id);
  }
  const idToName = new Map(responsibles.map((r) => [r.id, r.name]));
  const fallbackNameByKey = new Map<string, string>();
  const clientIdFromName = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const n = normalizeName(name);
    if (!n) return null;
    const respId = respByNormName.get(n);
    if (respId) return canonicalOf.get(respId) ?? respId;
    const key = `__name:${n}`;
    fallbackNameByKey.set(key, name);
    return key;
  };

  // 2. Facturas → cliente + retenciones + pagos directos
  const today = new Date();
  type Line = SharedInvoiceLine & { coverable: number };
  const invoiceMap = new Map<string, Line>();
  for (const inv of invoices) {
    const invoiceId = inv.id as string;
    let clientId: string | null = null;
    const respId = inv.responsible_id as string | null;
    if (respId) clientId = canonicalOf.get(respId) ?? respId;
    else clientId = clientIdFromName(inv.counterparty_name as string | null);
    if (!clientId) clientId = "__unknown";

    // H10: las NC parciales bajan el total exigible.
    const totalNeto = Math.max(0, Number(inv.total_amount ?? 0) - Math.abs(Number(inv.voided_amount ?? 0) || 0) * (inv.void_type === "partial" ? 1 : 0));
    const retenciones = invoiceRetencionesVenta(inv);
    invoiceMap.set(invoiceId, {
      id: invoiceId,
      invoice_number: (inv.invoice_number as string) ?? "",
      issue_date: inv.issue_date as string,
      due_date: (inv.due_date as string | null) ?? null,
      dias_credito: (inv.dias_credito as number | null) ?? null,
      total_neto: totalNeto,
      retenciones_total: retenciones,
      paid_direct: 0,
      effective_pending: 0,
      days_overdue: daysOverdue({ issue_date: inv.issue_date as string, due_date: (inv.due_date as string | null) ?? null, dias_credito: (inv.dias_credito as number | null) ?? null }, today),
      client_id: clientId,
      client_name: "",
      responsible_id: clientId.startsWith("__name:") || clientId === "__unknown" ? null : clientId,
      coverable: Math.max(0, totalNeto - retenciones),
    });
  }

  for (const tx of transactions) {
    if (!isOperativo(tx.movement_nature as string | null)) continue;
    const invId = tx.invoice_id as string | null;
    if (invId && invoiceMap.has(invId)) {
      invoiceMap.get(invId)!.paid_direct += Math.abs(Number(tx.amount ?? 0));
    }
  }
  for (const m of matches) {
    if (invoiceMap.has(m.invoice_id)) invoiceMap.get(m.invoice_id)!.paid_direct += Math.abs(Number(m.matched_amount ?? 0));
  }
  for (const d of initialDetails) {
    if (d.field_type === "anticipos_de_clientes" && d.invoice_id && invoiceMap.has(d.invoice_id as string)) {
      invoiceMap.get(d.invoice_id as string)!.paid_direct += Math.abs(Number(d.amount ?? 0));
    }
  }

  // 3. Atribuir cada ingreso operativo a UN cliente
  const matchTxToInvoices = new Map<string, string[]>();
  for (const m of matches) {
    const arr = matchTxToInvoices.get(m.transaction_id) ?? [];
    arr.push(m.invoice_id);
    matchTxToInvoices.set(m.transaction_id, arr);
  }
  const initialDetailById = new Map<string, Record<string, unknown>>();
  for (const d of initialDetails) initialDetailById.set(d.id as string, d);
  const initialMatchTxToDetail = new Map<string, string>();
  for (const im of initialMatches) initialMatchTxToDetail.set(im.transaction_id, im.initial_state_detail_id);

  const txClient = new Map<string, string>();
  let sinConciliarCount = 0;
  let sinConciliarMonto = 0;
  for (const tx of transactions) {
    if (!isOperativo(tx.movement_nature as string | null)) continue; // H6
    const txId = tx.id as string;
    let clientId: string | null = null;
    const txRespId = tx.responsible_id as string | null;
    if (txRespId) clientId = canonicalOf.get(txRespId) ?? txRespId;
    if (!clientId) {
      const invId = tx.invoice_id as string | null;
      if (invId && invoiceMap.has(invId)) clientId = invoiceMap.get(invId)!.client_id;
    }
    if (!clientId) {
      for (const invId of matchTxToInvoices.get(txId) ?? []) {
        if (invoiceMap.has(invId)) { clientId = invoiceMap.get(invId)!.client_id; break; }
      }
    }
    if (!clientId) {
      const detailId = initialMatchTxToDetail.get(txId);
      if (detailId) {
        const detail = initialDetailById.get(detailId);
        if (detail) {
          const detRespId = detail.responsible_id as string | null;
          if (detRespId) clientId = canonicalOf.get(detRespId) ?? detRespId;
          else clientId = clientIdFromName(detail.responsible_name as string | null);
        }
      }
    }
    if (clientId) txClient.set(txId, clientId);
    else { sinConciliarCount += 1; sinConciliarMonto += Math.abs(Number(tx.amount ?? 0)); }
  }

  // 4. Agregar por cliente
  type Accum = SharedClientReceivable & { _lines: Line[] };
  const acc = new Map<string, Accum>();
  const nameOf = (clientId: string): string =>
    clientId.startsWith("__name:") ? (fallbackNameByKey.get(clientId) ?? "(Sin nombre)") : (idToName.get(clientId) ?? "(Sin nombre)");
  const getAcc = (clientId: string): Accum => {
    let a = acc.get(clientId);
    if (!a) {
      a = {
        client_id: clientId,
        client_name: nameOf(clientId),
        responsible_id: clientId.startsWith("__name:") || clientId === "__unknown" ? null : clientId,
        facturado_venta: 0, cxc_inicial: 0, cobrado_banco: 0, cobrado_efectivo: 0,
        anticipos_total: 0, retenciones_total: 0, saldo_neto: 0, saldo_siigo: 0,
        oldest_overdue_days: 0, invoices_pendientes: [], _lines: [],
      };
      acc.set(clientId, a);
    }
    return a;
  };

  for (const inv of invoiceMap.values()) {
    const a = getAcc(inv.client_id);
    inv.client_name = a.client_name;
    a.facturado_venta += inv.total_neto;
    a.retenciones_total += inv.retenciones_total;
    a._lines.push(inv);
  }
  // saldo_siigo por cliente (para el cuadre)
  for (const inv of invoices) {
    const line = invoiceMap.get(inv.id as string);
    if (!line) continue;
    getAcc(line.client_id).saldo_siigo += Math.max(0, Number(inv.balance_pending ?? 0));
  }
  const txById = new Map(transactions.map((t) => [t.id as string, t]));
  for (const [txId, clientId] of txClient.entries()) {
    const tx = txById.get(txId);
    if (!tx) continue;
    getAcc(clientId).cobrado_banco += Math.abs(Number(tx.amount ?? 0));
  }
  for (const cm of cashIngresos) {
    const respId = cm.responsible_id;
    if (!respId) continue;
    const clientId = canonicalOf.get(respId) ?? respId;
    getAcc(clientId).cobrado_efectivo += Math.abs(Number(cm.amount ?? 0));
  }
  for (const d of initialDetails) {
    const amt = Math.abs(Number(d.amount ?? 0));
    let clientId: string | null = null;
    const respId = d.responsible_id as string | null;
    if (respId) clientId = canonicalOf.get(respId) ?? respId;
    else clientId = clientIdFromName(d.responsible_name as string | null);
    if (!clientId) {
      const invId = d.invoice_id as string | null;
      if (invId && invoiceMap.has(invId)) clientId = invoiceMap.get(invId)!.client_id;
    }
    if (!clientId) continue;
    const a = getAcc(clientId);
    if (d.field_type === "cuentas_por_cobrar") a.cxc_inicial += amt;
    else if (d.field_type === "anticipos_de_clientes") a.anticipos_total += amt;
  }

  // 5. FIFO + saldo neto
  const clients: SharedClientReceivable[] = [];
  const invoiceById = new Map<string, SharedInvoiceLine>();
  for (const a of acc.values()) {
    const credito = a.cobrado_banco + a.cobrado_efectivo + a.anticipos_total;
    a.saldo_neto = (a.facturado_venta + a.cxc_inicial) - (credito + a.retenciones_total);
    // FIFO idéntico a applyClientCreditFIFO de la app: el pool completo de
    // crédito (banco + efectivo + anticipos, reservando primero cxc_inicial
    // como deuda más vieja) se imputa oldest-first, sin importar a qué factura
    // vino vinculado cada pago — misma LIMITACIÓN consciente documentada allá:
    // el saldo TOTAL del cliente siempre es correcto, solo cambia en qué
    // factura "aterriza".
    let remaining = Math.max(0, credito - a.cxc_inicial);
    const ordered = [...a._lines].sort((x, y) =>
      x.issue_date < y.issue_date ? -1 : x.issue_date > y.issue_date ? 1 : x.invoice_number.localeCompare(y.invoice_number));
    for (const line of ordered) {
      const applied = Math.min(remaining, line.coverable);
      line.effective_pending = Math.max(0, line.coverable - applied);
      remaining -= applied;
    }
    a.oldest_overdue_days = Math.max(0, ...a._lines.filter((l) => l.effective_pending > PAID_EPSILON).map((l) => l.days_overdue));
    a.invoices_pendientes = a._lines
      .filter((l) => l.effective_pending > PAID_EPSILON)
      .sort((x, y) => y.effective_pending - x.effective_pending)
      .map(({ coverable: _c, ...rest }) => rest);
    for (const l of a._lines) {
      const { coverable: _c, ...rest } = l;
      invoiceById.set(l.id, rest);
    }
    delete (a as Partial<Accum>)._lines;
    if (a.facturado_venta > 0 || a.cxc_inicial > 0 || a.cobrado_banco > 0 || a.cobrado_efectivo > 0 || a.anticipos_total > 0) {
      clients.push(a);
    }
  }
  clients.sort((x, y) => y.saldo_neto - x.saldo_neto);

  return {
    clients,
    total_saldo_pendiente: clients.filter((c) => c.saldo_neto > 0).reduce((s, c) => s + c.saldo_neto, 0),
    total_saldo_a_favor: clients.filter((c) => c.saldo_neto < 0).reduce((s, c) => s + Math.abs(c.saldo_neto), 0),
    sin_conciliar: { count: sinConciliarCount, monto: sinConciliarMonto },
    invoiceById,
  };
}
