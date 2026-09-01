/**
 * Pestaña Escenarios — el contenedor VIGENTE bajo una TRM simulada.
 *
 * Responde las dos preguntas diarias de Nico sobre el pedido abierto:
 *   1. ¿Cuánta caja necesito para cerrar el saldo si el dólar está en X?
 *   2. ¿Cómo quedan el arancel y el IVA con lo ya pagado a sus TRMs reales
 *      y el saldo a la TRM de hoy / simulada?  (TRM mixta, ver
 *      computeImportBreakdown.trmMixta)
 *
 * REGLA DE LA PESTAÑA: esto es "lo real", no contabilidad — funciones puras,
 * solo lectura; nunca escriben nada. Los supuestos salen declarados para que
 * la UI los muestre, patrón de importComparison.
 */

import { computeImportBreakdown, type ImportBreakdown, type ImportCostLine } from '@/lib/importCosting';

export interface AbonoVigente {
  amount_usd: number;
  trm: number;
}

export interface EscenarioVigenteInput {
  /** Factura de mercancía confirmada (monto_total_usd del pedido). */
  mercanciaUsd: number;
  costs: ImportCostLine[] | undefined;
  abonos: AbonoVigente[];
  /** TRM del escenario para COMPRAR el saldo (arranca en la de hoy). */
  trmSimulada: number | null;
  /**
   * TRM de LIQUIDACION ADUANERA (la vigente del viernes). La DIAN liquida
   * arancel e IVA sobre esta, no sobre lo que promediaste comprando dólares.
   * Sin ella se usa trmSimulada.
   */
  trmAduana?: number | null;
  arancelPct: number;
  ivaPct: number;
  cantidadKg?: number | null;
}

export interface EscenarioVigente {
  totalUsd: number;
  pagadoUsd: number;
  /** COP efectivamente girado: Σ abono × SU trm — historia inmutable. */
  pagadoCop: number;
  /** TRM promedio ponderada de lo pagado (null sin abonos). */
  trmPonderadaPagado: number | null;
  saldoUsd: number;
  /** El saldo a la TRM simulada — la caja que falta para cerrar mercancía. */
  saldoCopSimulado: number | null;
  /** Breakdown completo (arancel/IVA con TRM mixta, piso FOB incluido). */
  breakdown: ImportBreakdown;
  /** Arancel + IVA estimados que faltan por pagar (netos de lo ya liquidado real). */
  impuestosPendientesCop: number | null;
  /** Caja total para dejar el contenedor cerrado: saldo + impuestos pendientes. */
  cajaParaCerrarCop: number | null;
  supuestos: string[];
}

const n0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function escenarioVigente(input: EscenarioVigenteInput): EscenarioVigente {
  const totalUsd = Math.max(0, n0(input.mercanciaUsd));
  const abonos = (input.abonos ?? []).filter((a) => n0(a.amount_usd) > 0 && n0(a.trm) > 0);
  const pagadoUsd = abonos.reduce((s, a) => s + n0(a.amount_usd), 0);
  const pagadoCop = abonos.reduce((s, a) => s + n0(a.amount_usd) * n0(a.trm), 0);
  const trmPonderadaPagado = pagadoUsd > 0 ? pagadoCop / pagadoUsd : null;
  const saldoUsd = Math.max(0, totalUsd - pagadoUsd);
  const trm = n0(input.trmSimulada) > 0 ? Number(input.trmSimulada) : null;

  const trmAduana = n0(input.trmAduana) > 0 ? Number(input.trmAduana) : trm;

  const breakdown = computeImportBreakdown({
    mercanciaUsd: totalUsd,
    costs: input.costs,
    trm,
    arancelPct: input.arancelPct,
    ivaPct: input.ivaPct,
    cantidadKg: input.cantidadKg ?? null,
    trmMixta: pagadoUsd > 0 ? { pagadoUsd, pagadoCop } : null,
    trmAduana,
  });

  const saldoCopSimulado = trm != null ? saldoUsd * trm : null;

  // Impuestos que FALTAN: los estimados del breakdown, menos nada si ya hay
  // liquidación real cargada (usaArancelReal/usaIvaReal ⇒ ya se pagaron o
  // están causados — no vuelven a pedir caja).
  const arancelPendiente = breakdown.usaArancelReal ? 0 : n0(breakdown.arancelCop);
  const ivaPendiente = breakdown.usaIvaReal ? 0 : n0(breakdown.ivaCop);
  const impuestosPendientesCop = breakdown.arancelCop == null && breakdown.ivaCop == null
    ? null
    : arancelPendiente + ivaPendiente;

  const cajaParaCerrarCop = saldoCopSimulado != null
    ? saldoCopSimulado + n0(impuestosPendientesCop)
    : null;

  const supuestos: string[] = [];
  if (pagadoUsd > 0) {
    supuestos.push(
      `Lo pagado (${Math.round(pagadoUsd).toLocaleString('es-CO')} USD) va a la TRM real de cada abono — promedio ${trmPonderadaPagado ? Math.round(trmPonderadaPagado).toLocaleString('es-CO') : '—'}.`,
    );
  }
  if (saldoUsd > 0 && trm != null) {
    supuestos.push(`El saldo (${Math.round(saldoUsd).toLocaleString('es-CO')} USD) se valora a la TRM del escenario (${Math.round(trm).toLocaleString('es-CO')}).`);
  }
  if (breakdown.pisoAplicado) {
    supuestos.push(`Impuestos liquidados sobre el piso FOB (${breakdown.pisoFobUsdKg} USD/kg): el precio real quedó por debajo.`);
  }
  if (trmAduana != null) {
    supuestos.push(`Arancel e IVA sobre la TRM de aduana (${Math.round(trmAduana).toLocaleString('es-CO')}) — la DIAN liquida a la TRM vigente, no al promedio que pagaste.`);
  }
  supuestos.push('Estimación para preparar caja — la liquidación real puede mover la TRM del día de nacionalización.');

  return {
    totalUsd, pagadoUsd, pagadoCop, trmPonderadaPagado, saldoUsd, saldoCopSimulado,
    breakdown, impuestosPendientesCop, cajaParaCerrarCop, supuestos,
  };
}
