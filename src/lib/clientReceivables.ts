// Cálculo de cartera por cliente, alineado con la lógica de PaymentsLogReport
// (la "fuente de verdad" para Nico). Hace queries bulk una sola vez y agrupa
// en memoria, así "Lo que me deben" arroja el mismo número que "Relación de
// Pagos" para cualquier cliente — por construcción, no por aritmética que
// coincide.
//
// Fórmula por cliente:
//
//   total_a_cobrar    = facturado_venta (excluyendo void_type='full') + cxc_inicial
//   total_recibido    = movIngresos (todos los pagos del banco del cliente,
//                                    estén o no vinculados a factura específica)
//                     + anticipos_de_clientes (linked + unlinked)
//                     + retenciones (retefuente + reteica + autoretefuente —
//                                    plata que el cliente retuvo y pagó a DIAN/
//                                    municipio en lugar de pagártela al banco)
//   saldo_neto        = total_a_cobrar − total_recibido
//
// Las retenciones se descuentan solo cuando están explícitamente cargadas en
// la factura (reteica_amount > 0, autoretefuente_amount > 0). retefuente
// mantiene el comportamiento legacy (default 2.5% si rate=null en facturas
// viejas), para no inflar saldos de facturas pre-existentes.
//
// saldo_neto < 0 → saldo a favor del cliente (le debemos / hay anticipo vivo).

import { supabase } from '@/integrations/supabase/client';

// Normalización fuerte de nombres (copiada de PaymentsLogReport para mantener
// criterio idéntico de matching).
function normalizeName(s: string): string {
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
  total_amount: number;
  retefuente: number;
  reteica: number;
  autoretefuente: number;
  /** retefuente + reteica + autoretefuente. Plata que el cliente retuvo en
   *  origen y pagó a DIAN/municipio — no te llega al banco, no es deuda viva. */
  retenciones_total: number;
  /** Pagos vinculados a esta factura específica (transactions.invoice_id + matches + anticipos linked). */
  paid_direct: number;
  /** total_amount − paid_direct − retenciones_total, clamped a 0. */
  pending_invoice: number;
  void_type: 'partial' | null;
  days_since: number;
}

export interface ClientReceivable {
  /** ID canónico: responsible_id o `__name:<normalizado>` si el cliente solo aparece por counterparty_name. */
  client_id: string;
  client_name: string;
  facturado_venta: number;
  cxc_inicial: number;
  /** Suma de ingresos del banco atribuidos a este cliente vía responsible_id, invoice_id o invoice_transaction_matches. */
  cobrado_banco: number;
  /** Anticipos del estado inicial (linked + unlinked) — restan del saldo. */
  anticipos_total: number;
  /** Suma de retenciones (retefuente + reteica + autoretefuente) en todas las
   *  facturas del cliente. Resta del saldo porque ya están pagadas a DIAN/municipio. */
  retenciones_total: number;
  /** (facturado + cxc_inicial) − (cobrado_banco + anticipos_total + retenciones_total). Negativo = saldo a favor del cliente. */
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

  // Bulk loads — todo el dataset que necesita el cálculo, en paralelo.
  const [
    responsiblesRes,
    aliasesRes,
    invoicesRes,
    transactionsRes,
    matchesRes,
    initialDetailsRes,
    initialMatchesRes,
  ] = await Promise.all([
    supabase.from('responsibles').select('id, name'),
    supabase.from('responsible_aliases' as never).select('responsible_id, alias'),
    supabase
      .from('invoices')
      // `void_type` se añadió en migración 20260514120000 pero todavía no está
      // en types generados; usamos `as never` para que TS no se queje del
      // select. El filtro `.or('void_type...')` funciona igual a nivel DB.
      .select('id, invoice_number, counterparty_name, responsible_id, issue_date, total_amount, subtotal_base, retefuente_cliente_amount, retefuente_cliente_rate, reteica_amount, autoretefuente_amount, void_type' as never)
      .eq('type', 'venta')
      .gte('issue_date', startDate)
      .lte('issue_date', endDate)
      // Excluir facturas totalmente anuladas por nota crédito — mismo criterio
      // que PaymentsLogReport. Antes, "Lo que me deben" las contaba como
      // pendientes y por eso aparecían deudas de 100M+ que ya estaban anuladas.
      .or('void_type.is.null,void_type.eq.partial'),
    supabase
      .from('transactions')
      .select('id, invoice_id, responsible_id, amount, type, date, description')
      .eq('type', 'ingreso')
      .is('deleted_at', null)
      .gte('date', startDate)
      .lte('date', endDate),
    supabase.from('invoice_transaction_matches').select('invoice_id, transaction_id, matched_amount'),
    supabase.from('initial_state_details').select('id, field_type, amount, invoice_id, responsible_id, responsible_name'),
    supabase.from('initial_balance_matches' as never).select('initial_state_detail_id, transaction_id, matched_amount'),
  ]);

  if (responsiblesRes.error) throw responsiblesRes.error;
  if (invoicesRes.error) throw invoicesRes.error;
  if (transactionsRes.error) throw transactionsRes.error;
  if (matchesRes.error) throw matchesRes.error;
  if (initialDetailsRes.error) throw initialDetailsRes.error;

  const responsibles = (responsiblesRes.data ?? []) as Array<{ id: string; name: string }>;
  const aliases = ((aliasesRes.data as unknown) as Array<{ responsible_id: string; alias: string }> | null) ?? [];
  const invoices = ((invoicesRes.data as unknown) ?? []) as Array<Record<string, unknown>>;
  const transactions = (transactionsRes.data ?? []) as Array<Record<string, unknown>>;
  const matches = (matchesRes.data ?? []) as Array<{ invoice_id: string; transaction_id: string; matched_amount: number }>;
  const initialDetails = (initialDetailsRes.data ?? []) as Array<Record<string, unknown>>;
  const initialMatches = ((initialMatchesRes.data as unknown) as Array<{ initial_state_detail_id: string; transaction_id: string; matched_amount: number }> | null) ?? [];

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

    const savedRete = Number((inv.retefuente_cliente_amount as number | null) ?? 0);
    const rawRate = inv.retefuente_cliente_rate as number | null | undefined;
    const hasExplicitRate = rawRate !== null && rawRate !== undefined;
    const effectiveRate = hasExplicitRate ? Number(rawRate) : 0.025;
    const retefuente = savedRete > 0
      ? savedRete
      : Math.round(Number(inv.subtotal_base ?? 0) * effectiveRate);
    // reteica + autoretefuente: solo descontar si están explícitamente
    // cargados en la factura (auto-detect por amount > 0). Facturas a clientes
    // que NO son agentes retenedores tienen estos campos en 0/null.
    const reteica = Math.abs(Number(inv.reteica_amount ?? 0));
    const autoretefuente = Math.abs(Number(inv.autoretefuente_amount ?? 0));
    const retenciones_total = retefuente + reteica + autoretefuente;

    const issueDate = inv.issue_date as string;
    const daysSince = Math.max(0, Math.floor((today.getTime() - new Date(issueDate).getTime()) / 86400000));

    invoiceMap.set(invoiceId, {
      id: invoiceId,
      invoice_number: (inv.invoice_number as string) ?? '',
      issue_date: issueDate,
      total_amount: Number(inv.total_amount ?? 0),
      retefuente,
      reteica,
      autoretefuente,
      retenciones_total,
      paid_direct: 0,
      pending_invoice: 0,
      void_type: (inv.void_type as 'partial' | null) ?? null,
      days_since: daysSince,
      client_id: clientId,
    });
  }

  // Pagos directos por factura (transactions.invoice_id)
  for (const tx of transactions) {
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
  for (const tx of transactions) {
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
  }

  // ===========================================================================
  // 4. Agregar por cliente canónico.
  // ===========================================================================
  type Accum = ClientReceivable & {
    _pendientes: InvoiceLine[];
    _pagadas: InvoiceLine[];
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
        anticipos_total: 0,
        retenciones_total: 0,
        saldo_neto: 0,
        invoices_pendientes: [],
        invoices_pagadas: [],
        _pendientes: [],
        _pagadas: [],
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
      total_amount: inv.total_amount,
      retefuente: inv.retefuente,
      reteica: inv.reteica,
      autoretefuente: inv.autoretefuente,
      retenciones_total: inv.retenciones_total,
      paid_direct: inv.paid_direct,
      pending_invoice: inv.pending_invoice,
      void_type: inv.void_type,
      days_since: inv.days_since,
    };
    if (inv.pending_invoice > 0) a._pendientes.push(line);
    else a._pagadas.push(line);
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
  // Saldos iniciales + anticipos
  for (const d of initialDetails) {
    const amt = Math.abs(Number(d.amount ?? 0));
    let clientId: string | null = null;
    const respId = d.responsible_id as string | null;
    if (respId) clientId = canonicalOf.get(respId) ?? respId;
    else clientId = clientIdFromName(d.responsible_name as string | null);
    if (!clientId) continue;
    const a = getAcc(clientId);
    if (d.field_type === 'cuentas_por_cobrar') a.cxc_inicial += amt;
    else if (d.field_type === 'anticipos_de_clientes') a.anticipos_total += amt;
  }

  // Saldo neto + ordenar invoices
  const clients: ClientReceivable[] = [];
  for (const a of acc.values()) {
    a.saldo_neto = (a.facturado_venta + a.cxc_inicial) - (a.cobrado_banco + a.anticipos_total + a.retenciones_total);
    a.invoices_pendientes = a._pendientes.sort((x, y) => y.pending_invoice - x.pending_invoice);
    a.invoices_pagadas = a._pagadas.sort((x, y) => new Date(y.issue_date).getTime() - new Date(x.issue_date).getTime());
    delete (a as Partial<Accum>)._pendientes;
    delete (a as Partial<Accum>)._pagadas;
    clients.push(a);
  }
  // Mostrar solo clientes con actividad
  const visible = clients.filter(c =>
    c.facturado_venta > 0 || c.cxc_inicial > 0 || c.cobrado_banco > 0 || c.anticipos_total > 0,
  );
  visible.sort((a, b) => b.saldo_neto - a.saldo_neto);

  const total_facturado = visible.reduce((s, c) => s + c.facturado_venta + c.cxc_inicial, 0);
  const total_cobrado = visible.reduce((s, c) => s + c.cobrado_banco + c.anticipos_total, 0);
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
  };
}
