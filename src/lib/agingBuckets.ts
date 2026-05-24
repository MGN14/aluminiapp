// Aging Report: distribuye las facturas pendientes de cada cliente en buckets
// de envejecimiento según días desde issue_date (y due_date si existe).
//
// Buckets (Colombia estándar):
//   - Corriente: aún no vencida (días vencidos <= 0)
//   - 1-30:  vencida hasta 30 días
//   - 31-60: vencida entre 31 y 60 días
//   - 61-90: vencida entre 61 y 90 días
//   - >90:   vencida hace más de 90 días (crítica)

import type { ClientReceivable, InvoiceLine } from './clientReceivables';

export interface AgingBuckets {
  corriente: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

export interface ClientAging {
  client_id: string;
  client_name: string;
  buckets: AgingBuckets;
  oldest_overdue_days: number; // 0 si todo es corriente
  responsible_id: string | null; // null si solo hay nombre
}

export interface AgingReport {
  clients: ClientAging[];
  totals: AgingBuckets;
  pct: {
    corriente: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
    vencido: number; // suma todas las vencidas / total
  };
}

const EMPTY_BUCKETS: AgingBuckets = {
  corriente: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
  total: 0,
};

/**
 * Calcula días vencidos de una factura.
 * Si hay due_date: today - due_date. Si solo hay issue_date: today - issue_date
 * (asumiendo crédito 0). Si dias_credito está seteado, sumarlo a issue_date.
 * Negativo = todavía no vencida.
 */
function calcDaysOverdue(inv: InvoiceLine & { due_date?: string | null; dias_credito?: number | null }, today: Date): number {
  // InvoiceLine no tiene due_date/dias_credito en la interface — vienen del invoice.
  // El caller debe pasar la info enriquecida o usar issue_date + dias_credito si están.
  const issueDate = new Date(inv.issue_date);
  let vencimientoDate: Date;
  if (inv.due_date) {
    vencimientoDate = new Date(inv.due_date);
  } else if (inv.dias_credito && inv.dias_credito > 0) {
    vencimientoDate = new Date(issueDate);
    vencimientoDate.setDate(vencimientoDate.getDate() + inv.dias_credito);
  } else {
    // Sin due_date ni dias_credito → asumimos vencimiento = issue_date (crédito 0)
    vencimientoDate = issueDate;
  }
  const ms = today.getTime() - vencimientoDate.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function bucketOf(daysOverdue: number): keyof AgingBuckets {
  if (daysOverdue <= 0) return 'corriente';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

/**
 * Recibe el resultado de calculateAllClientReceivables enriquecido con info
 * de due_date/dias_credito por factura. Devuelve el aging report.
 *
 * NOTE: para no romper la firma de InvoiceLine, este helper espera que las
 * facturas vengan con due_date y dias_credito ya hidratados desde otra query.
 */
export function calculateAgingFromClients(
  clients: (ClientReceivable & { responsible_id?: string | null })[],
  invoiceMeta: Map<string, { due_date: string | null; dias_credito: number | null }>,
  today: Date = new Date(),
): AgingReport {
  const result: ClientAging[] = [];
  const totals: AgingBuckets = { ...EMPTY_BUCKETS };

  for (const c of clients) {
    if (c.saldo_neto <= 0) continue; // solo deudores

    const buckets: AgingBuckets = { ...EMPTY_BUCKETS };
    let oldestOverdue = 0;

    for (const inv of c.invoices_pendientes) {
      if (inv.pending_invoice <= 0) continue;
      const meta = invoiceMeta.get(inv.id) || { due_date: null, dias_credito: null };
      const enriched = { ...inv, due_date: meta.due_date, dias_credito: meta.dias_credito };
      const daysOverdue = calcDaysOverdue(enriched, today);
      const bucket = bucketOf(daysOverdue);
      buckets[bucket] += inv.pending_invoice;
      buckets.total += inv.pending_invoice;
      if (daysOverdue > oldestOverdue) oldestOverdue = daysOverdue;
    }

    // Si el cliente tiene saldo_neto positivo pero ninguna factura vencida
    // (puede pasar con saldos legacy), todo va a corriente.
    if (buckets.total === 0 && c.saldo_neto > 0) {
      buckets.corriente = c.saldo_neto;
      buckets.total = c.saldo_neto;
    }

    result.push({
      client_id: c.client_id,
      client_name: c.client_name,
      responsible_id: c.responsible_id ?? null,
      buckets,
      oldest_overdue_days: oldestOverdue,
    });

    totals.corriente += buckets.corriente;
    totals.d1_30 += buckets.d1_30;
    totals.d31_60 += buckets.d31_60;
    totals.d61_90 += buckets.d61_90;
    totals.d90_plus += buckets.d90_plus;
    totals.total += buckets.total;
  }

  // Ordenar clientes por días más viejos descendente (los más críticos primero)
  result.sort((a, b) => b.oldest_overdue_days - a.oldest_overdue_days || b.buckets.total - a.buckets.total);

  const safeDiv = (n: number, d: number) => (d > 0 ? n / d : 0);
  const vencido = totals.d1_30 + totals.d31_60 + totals.d61_90 + totals.d90_plus;

  return {
    clients: result,
    totals,
    pct: {
      corriente: safeDiv(totals.corriente, totals.total),
      d1_30: safeDiv(totals.d1_30, totals.total),
      d31_60: safeDiv(totals.d31_60, totals.total),
      d61_90: safeDiv(totals.d61_90, totals.total),
      d90_plus: safeDiv(totals.d90_plus, totals.total),
      vencido: safeDiv(vencido, totals.total),
    },
  };
}
