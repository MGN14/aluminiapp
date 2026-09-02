// Cálculo de cartera por cliente, alineado con la lógica de PaymentsLogReport
// (la "fuente de verdad" para Nico). Hace queries bulk una sola vez y agrupa
// en memoria, así "Lo que me deben" arroja el mismo número que "Relación de
// Pagos" para cualquier cliente — por construcción, no por aritmética que
// coincide.
//
// Fórmula por cliente (auditoría 2026-08-12):
//
//   total_a_cobrar    = facturado_venta NETO de NC parciales (total − voided_amount;
//                       void_type='total' excluida) + cxc_inicial
//   total_recibido    = ingresos del banco OPERATIVOS del cliente (traspasos,
//                       préstamos y aportes con beneficiario NO bajan cartera)
//                     + efectivo con beneficiario (cash_movements type=ingreso —
//                       Ronal pagó $24.85M en caja y la app decía que debía)
//                     + anticipos_de_clientes (linked + unlinked)
//                     + retenciones (retefuente + reteica + autoretefuente —
//                                    plata que el cliente retuvo y pagó a DIAN/
//                                    municipio en lugar de pagártela al banco)
//   saldo_neto        = total_a_cobrar − total_recibido
//
// Las retenciones se descuentan solo cuando están explícitamente cargadas en
// la factura. saldo_neto < 0 → saldo a favor del cliente (anticipo vivo).
//
// GEMELO Deno: supabase/functions/_shared/receivables.ts — score IA, reporte
// semanal, mensajes de cobro, link Wompi y MCP leen ESA copia. Cualquier
// cambio acá se replica allá (mismo patrón que ublInvoiceParser).

import { supabase } from '@/integrations/supabase/client';
import { invoiceRetenciones } from './invoiceBalance';
import { isOperativo } from '@/types/transaction';

// Normalización fuerte de nombres (copiada de PaymentsLogReport para mantener
// criterio idéntico de matching). Exportada para que los módulos que crucen
// datos por nombre (Estado de cuenta clientes) usen EL MISMO criterio.
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+s\.?a\.?s\.?\s*$/i, '')
    .replace(/\s+ltda\.?\s*$/i, '')
    .replace(/\s+s\.?a\.?\s*$/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface InvoiceLine {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  dias_credito: number | null;
  /** total_amount − voided_amount de NC parciales. Lo realmente exigible. */
  total_amount: number;
  retefuente: number;
  reteica: number;
  autoretefuente: number;
  /** retefuente + reteica + autoretefuente. Plata que el cliente retuvo en
   *  origen y pagó a DIAN/municipio — no te llega al banco, no es deuda viva. */
  retenciones_total: number;
  /** Pagos vinculados a esta factura específica (transactions.invoice_id + matches + anticipos linked). */
  paid_direct: number;
  /** total_amount − paid_direct − retenciones_total, clamped a 0. Solo cuenta
   *  pagos vinculados explícitamente — NO el crédito del cliente sin imputar. */
  pending_invoice: number;
  /** Saldo real tras imputar TODO el crédito recibido del cliente (cobrado_banco
   *  + anticipos) a sus facturas de la más vieja a la más nueva (FIFO, Art.
   *  1653-1654 CC). Es el número que se muestra en cartera/conciliación/aging:
   *  para clientes que prepagan, una factura vieja cubierta por anticipos queda
   *  en 0 aunque la transferencia no esté vinculada a esa factura puntual.
   *  Σ effective_pending por cliente = max(0, saldo) — sin doble conteo. */
  effective_pending: number;
  void_type: 'partial' | null;
  days_since: number;
}

/**
 * Imputación de pagos (Código Civil, Art. 1653-1654): reparte el crédito
 * disponible del cliente sobre sus facturas, de la más vieja a la más nueva.
 * Muta cada línea seteando `effective_pending` = lo que queda pendiente de esa
 * factura una vez aplicada toda la plata recibida del cliente.
 *
 * Sin esto, una factura cubierta por anticipos/transferencias no vinculadas a
 * ella seguía mostrando el saldo completo (divergiendo del saldo neto del
 * cliente). El "coverable" de cada factura es total − retenciones (las
 * retenciones ya se pagaron a DIAN/municipio, no entran por banco).
 *
 * LIMITACIÓN consciente: la imputación es por defecto (oldest-first), así que un
 * anticipo vinculado a propósito a una factura NUEVA se reimputa igual a las más
 * viejas. El saldo TOTAL del cliente queda siempre correcto; solo cambia en qué
 * factura "aterriza" la deuda. Es el comportamiento que pide el negocio (y el
 * Art. 1653-1654 CC) para clientes que pagan a cuenta sin imputar cada giro.
 */
export function applyClientCreditFIFO(lines: InvoiceLine[], totalCredit: number): void {
  let remaining = Math.max(0, totalCredit);
  // Más vieja primero: issue_date en ISO (yyyy-mm-dd) ordena cronológicamente
  // como string; desempate estable por número de factura.
  const ordered = [...lines].sort((a, b) =>
    a.issue_date < b.issue_date ? -1
    : a.issue_date > b.issue_date ? 1
    : a.invoice_number.localeCompare(b.invoice_number));
  for (const line of ordered) {
    const coverable = Math.max(0, line.total_amount - line.retenciones_total);
    const applied = Math.min(remaining, coverable);
    line.effective_pending = Math.max(0, coverable - applied);
    remaining -= applied;
  }
}

/** Saldos menores a esto se consideran 0 (residuos por decimales de retención). */
const PAID_EPSILON = 1;

export interface ClientReceivable {
  /** ID canónico: responsible_id o `__name:<normalizado>` si el cliente solo aparece por counterparty_name. */
  client_id: string;
  client_name: string;
  facturado_venta: number;
  cxc_inicial: number;
  /** Suma de ingresos del banco OPERATIVOS atribuidos a este cliente vía responsible_id, invoice_id o invoice_transaction_matches. */
  cobrado_banco: number;
  /** Efectivo recibido del cliente (cash_movements type=ingreso con responsible_id). */
  cobrado_efectivo: number;
  /** Σ balance_pending crudo de Siigo — SOLO para el cuadre app vs Siigo. */
  saldo_siigo: number;
  /** Anticipos del estado inicial (linked + unlinked) — restan del saldo. */
  anticipos_total: number;
  /** Suma de retenciones (retefuente + reteica + autoretefuente) en todas las
   *  facturas del cliente. Resta del saldo porque ya están pagadas a DIAN/municipio. */
  retenciones_total: number;
  /** (facturado + cxc_inicial) − (cobrado_banco + cobrado_efectivo + anticipos_total + retenciones_total). Negativo = saldo a favor del cliente. */
  saldo_neto: number;
  invoices_pendientes: InvoiceLine[];
  invoices_pagadas: InvoiceLine[];
}

export interface ClientReceivablesResult {
  clients: ClientReceivable[];
  total_facturado: number;
  total_cobrado: number;
  /** Suma de saldos positivos = la "cartera" total que te deben. */
  total_saldo_pendiente: number;
  /** Suma de saldos negativos en valor absoluto = anticipos vivos / lo que le debés a clientes. */
  total_saldo_a_favor: number;
  clientes_con_deuda: number;
  /** Ingresos operativos del año sin cliente atribuible — KPI de confianza:
   *  la cartera puede estar sobrestimada hasta por este monto. */
  sin_conciliar: { count: number; monto: number };
}

/** Trae TODAS las filas paginando de a 1000. PostgREST corta en 1000 en
 *  silencio (auditoría H5) — mismo patrón que useProfitability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Calcula la cartera para todos los clientes con actividad en el año.
 * Usa la misma fórmula que PaymentsLogReport per-cliente (ver doc al inicio).
 */
export async function calculateAllClientReceivables(
  year: number,
): Promise<ClientReceivablesResult> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Bulk loads — todo el dataset que necesita el cálculo, en paralelo y
  // paginado (H5: PostgREST corta en 1000 filas sin avisar).
  const [
    responsibles,
    aliases,
    invoices,
    transactions,
    matches,
    initialDetails,
    initialMatches,
    cashIngresos,
  ] = await Promise.all([
    fetchAll<{ id: string; name: string }>((a, b) =>
      supabase.from('responsibles').select('id, name').range(a, b)),
    fetchAll<{ responsible_id: string; alias: string }>((a, b) =>
      supabase.from('responsible_aliases' as never).select('responsible_id, alias').range(a, b)),
    fetchAll<Record<string, unknown>>((a, b) =>
      supabase
        .from('invoices')
        // `void_type`/`voided_amount`/`balance_pending` no están en los types
        // generados; `as never` para que TS no se queje del select.
        .select('id, invoice_number, counterparty_name, responsible_id, issue_date, due_date, dias_credito, total_amount, subtotal_base, retefuente_cliente_amount, retefuente_cliente_rate, reteica_amount, autoretefuente_amount, void_type, voided_amount, balance_pending' as never)
        .eq('type', 'venta')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate)
        // Excluir facturas totalmente anuladas por nota crédito — mismo criterio
        // que PaymentsLogReport.
        .or('void_type.is.null,void_type.eq.partial')
        .range(a, b)),
    fetchAll<Record<string, unknown>>((a, b) =>
      supabase
        .from('transactions')
        .select('id, invoice_id, responsible_id, amount, type, date, description, movement_nature' as never)
        .eq('type', 'ingreso')
        .is('deleted_at', null)
        .gte('date', startDate)
        .lte('date', endDate)
        .range(a, b)),
    fetchAll<{ invoice_id: string; transaction_id: string; matched_amount: number }>((a, b) =>
      supabase.from('invoice_transaction_matches').select('invoice_id, transaction_id, matched_amount').range(a, b)),
    fetchAll<Record<string, unknown>>((a, b) =>
      supabase.from('initial_state_details').select('id, field_type, amount, invoice_id, responsible_id, responsible_name').range(a, b)),
    fetchAll<{ initial_state_detail_id: string; transaction_id: string }>((a, b) =>
      supabase.from('initial_balance_matches' as never).select('initial_state_detail_id, transaction_id').range(a, b)),
    // H7: efectivo con beneficiario. NO se lee petty_cash acá, así que los
    // promovidos no se cuentan doble.
    fetchAll<{ responsible_id: string | null; amount: number }>((a, b) =>
      supabase
        .from('cash_movements')
        .select('responsible_id, amount')
        .eq('type', 'ingreso')
        .not('responsible_id', 'is', null)
        .gte('date', startDate)
        .lte('date', endDate)
        .range(a, b)),
  ]);

  // ===========================================================================
  // 1. Map "alias responsible → canonical responsible". Si un responsible "Aluminios JH"
  //    aparece como alias de "Aluminios del Eje", todas sus facturas/pagos se
  //    atribuyen al canónico.
  // ===========================================================================
  const canonicalOf = new Map<string, string>();
  responsibles.forEach(r => canonicalOf.set(r.id, r.id));

  const respByNormName = new Map<string, string>();
  responsibles.forEach(r => {
    const n = normalizeName(r.name);
    if (n) respByNormName.set(n, r.id);
  });

  for (const a of aliases) {
    const legacyId = respByNormName.get(normalizeName(a.alias));
    if (legacyId && legacyId !== a.responsible_id) {
      canonicalOf.set(legacyId, a.responsible_id);
    }
  }

  const idToName = new Map(responsibles.map(r => [r.id, r.name]));
  const fallbackClientByKey = new Map<string, string>();

  // Resuelve un client_id canónico a partir de un nombre suelto (counterparty
  // sin responsible_id, o responsible_name de initial_state_details).
  const clientIdFromName = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const n = normalizeName(name);
    if (!n) return null;
    const respId = respByNormName.get(n);
    if (respId) return canonicalOf.get(respId) ?? respId;
    const key = `__name:${n}`;
    fallbackClientByKey.set(key, name);
    return key;
  };

  // ===========================================================================
  // 2. Por cada factura: atribuir cliente canónico + calcular retefuente y
  //    pagos directos (transactions.invoice_id + matches + anticipos linked).
  // ===========================================================================
  type InvoiceComputed = InvoiceLine & { client_id: string };
  const invoiceMap = new Map<string, InvoiceComputed>();
  const today = new Date();

  for (const inv of invoices) {
    const invoiceId = inv.id as string;
    let clientId: string | null = null;
    const respId = inv.responsible_id as string | null;
    if (respId) {
      clientId = canonicalOf.get(respId) ?? respId;
    } else {
      clientId = clientIdFromName(inv.counterparty_name as string | null);
    }
    if (!clientId) clientId = '__unknown';

    // Retenciones — fórmula compartida (lib/invoiceBalance) para que cobranza,
    // conciliación y anticipos cuadren siempre. Acá `inv` no trae `type` → la
    // función asume 'venta', idéntico al cálculo que vivía inline antes.
    const { retefuente, reteica, autoretefuente, total: retenciones_total } = invoiceRetenciones(inv);

    const issueDate = inv.issue_date as string;
    const daysSince = Math.max(0, Math.floor((today.getTime() - new Date(issueDate).getTime()) / 86400000));

    // H10: una NC parcial baja lo exigible. Antes la factura seguía pidiendo
    // el total bruto aunque la nota crédito ya había anulado una parte.
    const voidType = (inv.void_type as 'partial' | null) ?? null;
    const totalNeto = Math.max(0,
      Number(inv.total_amount ?? 0) - (voidType === 'partial' ? Math.abs(Number(inv.voided_amount ?? 0)) : 0));

    invoiceMap.set(invoiceId, {
      id: invoiceId,
      invoice_number: (inv.invoice_number as string) ?? '',
      issue_date: issueDate,
      due_date: (inv.due_date as string | null) ?? null,
      dias_credito: (inv.dias_credito as number | null) ?? null,
      total_amount: totalNeto,
      retefuente,
      reteica,
      autoretefuente,
      retenciones_total,
      paid_direct: 0,
      pending_invoice: 0,
      effective_pending: 0, // se recalcula por FIFO al agregar por cliente

      void_type: voidType,
      days_since: daysSince,
      client_id: clientId,
    });
  }

  // Pagos directos por factura (transactions.invoice_id) — solo operativos
  // (H6: un traspaso vinculado por error a una factura no es un pago).
  for (const tx of transactions) {
    if (!isOperativo(tx.movement_nature as string | null)) continue;
    const invId = tx.invoice_id as string | null;
    if (invId && invoiceMap.has(invId)) {
      invoiceMap.get(invId)!.paid_direct += Math.abs(Number(tx.amount ?? 0));
    }
  }
  // Matches (invoice_transaction_matches)
  for (const m of matches) {
    if (invoiceMap.has(m.invoice_id)) {
      invoiceMap.get(m.invoice_id)!.paid_direct += Math.abs(Number(m.matched_amount ?? 0));
    }
  }
  // Anticipos linked a una factura específica
  for (const d of initialDetails) {
    if (d.field_type === 'anticipos_de_clientes' && d.invoice_id) {
      const invId = d.invoice_id as string;
      if (invoiceMap.has(invId)) {
        invoiceMap.get(invId)!.paid_direct += Math.abs(Number(d.amount ?? 0));
      }
    }
  }
  for (const inv of invoiceMap.values()) {
    inv.pending_invoice = Math.max(0, inv.total_amount - inv.paid_direct - inv.retenciones_total);
  }

  // ===========================================================================
  // 3. Atribuir cada transacción de ingreso a UN cliente canónico.
  //    Prioridad: responsible_id → invoice_id → invoice_transaction_matches
  //             → initial_balance_matches → counterparty (no disponible aquí).
  // ===========================================================================
  const matchTxToInvoices = new Map<string, string[]>();
  for (const m of matches) {
    const arr = matchTxToInvoices.get(m.transaction_id) ?? [];
    arr.push(m.invoice_id);
    matchTxToInvoices.set(m.transaction_id, arr);
  }
  // initial_balance_matches: transaction → initial_state_detail → responsible
  const initialDetailById = new Map<string, Record<string, unknown>>();
  for (const d of initialDetails) initialDetailById.set(d.id as string, d);
  const initialMatchTxToDetail = new Map<string, string>();
  for (const im of initialMatches) initialMatchTxToDetail.set(im.transaction_id, im.initial_state_detail_id);

  const txClient = new Map<string, string>(); // tx_id → client_id
  let sinConciliarCount = 0;
  let sinConciliarMonto = 0;
  for (const tx of transactions) {
    // H6: traspasos, préstamos, devoluciones y aportes NO son cobros de venta
    // aunque tengan beneficiario — mismo criterio que PyG y Punto de Equilibrio.
    if (!isOperativo(tx.movement_nature as string | null)) continue;
    const txId = tx.id as string;
    let clientId: string | null = null;

    const txRespId = tx.responsible_id as string | null;
    if (txRespId) clientId = canonicalOf.get(txRespId) ?? txRespId;

    if (!clientId) {
      const invId = tx.invoice_id as string | null;
      if (invId && invoiceMap.has(invId)) {
        clientId = invoiceMap.get(invId)!.client_id;
      }
    }

    if (!clientId) {
      const matchedInvIds = matchTxToInvoices.get(txId) ?? [];
      for (const invId of matchedInvIds) {
        if (invoiceMap.has(invId)) {
          clientId = invoiceMap.get(invId)!.client_id;
          break;
        }
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
    else {
      sinConciliarCount += 1;
      sinConciliarMonto += Math.abs(Number(tx.amount ?? 0));
    }
  }

  // ===========================================================================
  // 4. Agregar por cliente canónico.
  // ===========================================================================
  type Accum = ClientReceivable & {
    _lines: InvoiceLine[];
  };
  const acc = new Map<string, Accum>();
  const nameOf = (clientId: string): string => {
    if (clientId.startsWith('__name:')) return fallbackClientByKey.get(clientId) ?? '(Sin nombre)';
    return idToName.get(clientId) ?? '(Sin nombre)';
  };
  const getAcc = (clientId: string): Accum => {
    let a = acc.get(clientId);
    if (!a) {
      a = {
        client_id: clientId,
        client_name: nameOf(clientId),
        facturado_venta: 0,
        cxc_inicial: 0,
        cobrado_banco: 0,
        cobrado_efectivo: 0,
        saldo_siigo: 0,
        anticipos_total: 0,
        retenciones_total: 0,
        saldo_neto: 0,
        invoices_pendientes: [],
        invoices_pagadas: [],
        _lines: [],
      };
      acc.set(clientId, a);
    }
    return a;
  };

  // Facturas
  for (const inv of invoiceMap.values()) {
    const a = getAcc(inv.client_id);
    a.facturado_venta += inv.total_amount;
    a.retenciones_total += inv.retenciones_total;
    const line: InvoiceLine = {
      id: inv.id,
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      dias_credito: inv.dias_credito,
      total_amount: inv.total_amount,
      retefuente: inv.retefuente,
      reteica: inv.reteica,
      autoretefuente: inv.autoretefuente,
      retenciones_total: inv.retenciones_total,
      paid_direct: inv.paid_direct,
      pending_invoice: inv.pending_invoice,
      effective_pending: inv.pending_invoice, // se recalcula por FIFO abajo
      void_type: inv.void_type,
      days_since: inv.days_since,
    };
    a._lines.push(line);
  }
  // Ingresos del banco
  const txById = new Map<string, Record<string, unknown>>();
  for (const tx of transactions) txById.set(tx.id as string, tx);
  for (const [txId, clientId] of txClient.entries()) {
    const tx = txById.get(txId);
    if (!tx) continue;
    const a = getAcc(clientId);
    a.cobrado_banco += Math.abs(Number(tx.amount ?? 0));
  }
  // Efectivo con beneficiario (H7)
  for (const cm of cashIngresos) {
    if (!cm.responsible_id) continue;
    const clientId = canonicalOf.get(cm.responsible_id) ?? cm.responsible_id;
    getAcc(clientId).cobrado_efectivo += Math.abs(Number(cm.amount ?? 0));
  }
  // Saldo según Siigo por cliente (solo referencia de cuadre)
  for (const inv of invoices) {
    const line = invoiceMap.get(inv.id as string);
    if (!line) continue;
    getAcc(line.client_id).saldo_siigo += Math.max(0, Number((inv as Record<string, unknown>).balance_pending ?? 0));
  }
  // Saldos iniciales + anticipos
  for (const d of initialDetails) {
    const amt = Math.abs(Number(d.amount ?? 0));
    let clientId: string | null = null;
    const respId = d.responsible_id as string | null;
    if (respId) clientId = canonicalOf.get(respId) ?? respId;
    else clientId = clientIdFromName(d.responsible_name as string | null);
    // Fallback por invoice_id: un anticipo importado del estado inicial puede
    // venir vinculado a una factura puntual SIN responsible_id/nombre del
    // cliente. Sin atribuirlo, el FIFO no lo aplicaba y la factura mostraba
    // saldo de más (regresión que afectaba a Alu Colombia: el anticipo del 2025
    // ligado a la factura no descontaba). Lo asignamos al cliente de esa factura.
    if (!clientId) {
      const invId = d.invoice_id as string | null;
      if (invId && invoiceMap.has(invId)) clientId = invoiceMap.get(invId)!.client_id;
    }
    if (!clientId) continue;
    const a = getAcc(clientId);
    if (d.field_type === 'cuentas_por_cobrar') a.cxc_inicial += amt;
    else if (d.field_type === 'anticipos_de_clientes') a.anticipos_total += amt;
  }

  // Saldo neto + ordenar invoices
  const clients: ClientReceivable[] = [];
  for (const a of acc.values()) {
    a.saldo_neto = (a.facturado_venta + a.cxc_inicial) - (a.cobrado_banco + a.cobrado_efectivo + a.anticipos_total + a.retenciones_total);
    // Imputación FIFO: reparte el crédito recibido del cliente (banco +
    // efectivo + anticipos) sobre sus facturas, de la más vieja a la más nueva.
    // Recién acá `effective_pending` queda con el saldo real por factura.
    // El saldo inicial (cxc_inicial) es la deuda MÁS vieja (anterior al sistema,
    // sin factura), así que por imputación se cubre primero: lo reservamos del
    // pool. Sin esto, el crédito "pagaría" facturas nuevas dejando viva la deuda
    // vieja → factura marcada Cubierta de más y plata desaparecida del aging.
    const creditParaFacturas = Math.max(0, a.cobrado_banco + a.cobrado_efectivo + a.anticipos_total - a.cxc_inicial);
    applyClientCreditFIFO(a._lines, creditParaFacturas);
    a.invoices_pendientes = a._lines
      .filter(l => l.effective_pending > PAID_EPSILON)
      .sort((x, y) => y.effective_pending - x.effective_pending);
    a.invoices_pagadas = a._lines
      .filter(l => l.effective_pending <= PAID_EPSILON)
      .sort((x, y) => (x.issue_date < y.issue_date ? 1 : x.issue_date > y.issue_date ? -1 : 0)); // más nueva primero
    delete (a as Partial<Accum>)._lines;
    clients.push(a);
  }
  // Mostrar solo clientes con actividad
  const visible = clients.filter(c =>
    c.facturado_venta > 0 || c.cxc_inicial > 0 || c.cobrado_banco > 0 || c.cobrado_efectivo > 0 || c.anticipos_total > 0,
  );
  visible.sort((a, b) => b.saldo_neto - a.saldo_neto);

  const total_facturado = visible.reduce((s, c) => s + c.facturado_venta + c.cxc_inicial, 0);
  const total_cobrado = visible.reduce((s, c) => s + c.cobrado_banco + c.cobrado_efectivo + c.anticipos_total, 0);
  const total_saldo_pendiente = visible
    .filter(c => c.saldo_neto > 0)
    .reduce((s, c) => s + c.saldo_neto, 0);
  const total_saldo_a_favor = visible
    .filter(c => c.saldo_neto < 0)
    .reduce((s, c) => s + Math.abs(c.saldo_neto), 0);
  const clientes_con_deuda = visible.filter(c => c.saldo_neto > 0).length;

  return {
    clients: visible,
    total_facturado,
    total_cobrado,
    total_saldo_pendiente,
    total_saldo_a_favor,
    clientes_con_deuda,
    sin_conciliar: { count: sinConciliarCount, monto: sinConciliarMonto },
  };
}
