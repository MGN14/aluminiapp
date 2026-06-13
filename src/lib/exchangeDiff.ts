/**
 * Diferencia en cambio sobre una importación en USD.
 *
 * Convención (cuenta por pagar en USD):
 *   - Se causa la deuda a una TRM de referencia (trm_causacion).
 *   - Cada abono se paga a la TRM del día (import_payments.trm).
 *   - El saldo pendiente se revalúa a la TRM de hoy.
 *
 * Signo: POSITIVO = PÉRDIDA en cambio (el dólar subió respecto a la causación
 * → pagás/debés más COP). NEGATIVO = GANANCIA. Es resultado financiero, no
 * operativo: no afecta el margen del producto, pero sí la utilidad y la renta.
 *
 * Función pura → testeable.
 */

export interface ExchangePayment {
  amount_usd: number;
  trm: number;
  /** Fecha del abono (YYYY-MM-DD). Define cuál es el "primer" abono cuando se
   *  usa como TRM de referencia por falta de trm_causacion. */
  fecha?: string;
}

export interface ExchangeDiffInput {
  /** TRM de causación. Si null/0, se usa la TRM del primer abono como referencia. */
  trmCausacion: number | null;
  payments: ExchangePayment[];
  /** Saldo pendiente en USD (monto_total_usd − Σ abonos). */
  saldoUsd: number;
  /** TRM de hoy para revaluar el saldo. Si null/0, no se calcula la parte no realizada. */
  trmHoy: number | null;
}

export interface ExchangeDiffResult {
  /** TRM de referencia efectivamente usada. */
  trmReferencia: number | null;
  /** Diferencia realizada (sobre abonos ya pagados), en COP. + = pérdida. */
  realizada: number;
  /** Diferencia no realizada (sobre saldo pendiente a TRM de hoy), en COP. + = pérdida. */
  noRealizada: number;
  /** realizada + noRealizada. + = pérdida, − = ganancia. */
  total: number;
  /** TRM promedio ponderada de los abonos (informativa). */
  trmPromedioPagos: number | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function computeExchangeDiff(input: ExchangeDiffInput): ExchangeDiffResult {
  // Orden estable por fecha ASC: el "primer abono" (referencia fallback) debe
  // ser el más antiguo, no el primero que vino de la query.
  const payments = input.payments
    .filter((p) => num(p.amount_usd) > 0 && num(p.trm) > 0)
    .slice()
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));

  const totalPagadoUsd = payments.reduce((s, p) => s + num(p.amount_usd), 0);
  const totalPagadoCop = payments.reduce((s, p) => s + num(p.amount_usd) * num(p.trm), 0);
  const trmPromedioPagos = totalPagadoUsd > 0 ? r2(totalPagadoCop / totalPagadoUsd) : null;

  // Referencia: trm_causacion explícita, o la TRM del primer abono.
  const trmRef = num(input.trmCausacion) > 0
    ? num(input.trmCausacion)
    : (payments.length > 0 ? num(payments[0].trm) : null);

  if (trmRef === null) {
    return { trmReferencia: null, realizada: 0, noRealizada: 0, total: 0, trmPromedioPagos };
  }

  // Realizada: por cada abono, (TRM_pago − TRM_ref) × USD. + = pagaste más COP.
  const realizada = r2(payments.reduce((s, p) => s + num(p.amount_usd) * (num(p.trm) - trmRef), 0));

  // No realizada: saldo pendiente revaluado a TRM de hoy.
  const trmHoy = num(input.trmHoy);
  const saldoUsd = Math.max(0, num(input.saldoUsd));
  const noRealizada = trmHoy > 0 ? r2(saldoUsd * (trmHoy - trmRef)) : 0;

  return {
    trmReferencia: trmRef,
    realizada,
    noRealizada,
    total: r2(realizada + noRealizada),
    trmPromedioPagos,
  };
}
