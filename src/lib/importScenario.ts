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
  /**
   * Saldo REAL del pedido (imports.saldo_pendiente_usd, columna GENERATED
   * monto_total_usd − anticipo_pagado_usd). Cuando viene, MANDA sobre
   * mercancía − Σabonos: así "USD que falta comprar" es EL MISMO número de
   * la pestaña Pedidos por construcción, sin importar filtros ni abonos
   * manuales del tablero (fix 36k vs 41k, Nico 2026-09-03).
   */
  saldoUsdReal?: number | null;
  /**
   * Flete + seguro en USD que se le giran AL MISMO proveedor (Incoterm CIF).
   * ENTRAN al saldo: es plata que hay que comprar y mandar a China igual que
   * la mercancía. El Excel de Nico lo dice explícito — "Saldo Con freight
   * 41.924" vs "Balance no freight 36.114" (2026-09-03). Antes el tablero
   * solo miraba mercancía y por eso pedía 5.810 USD de menos.
   */
  fleteSeguroUsd?: number | null;
}

export interface EscenarioVigente {
  totalUsd: number;
  pagadoUsd: number;
  /** COP efectivamente girado: Σ abono × SU trm — historia inmutable. */
  pagadoCop: number;
  /** TRM promedio ponderada de lo pagado (null sin abonos). */
  trmPonderadaPagado: number | null;
  /** Saldo REAL con el proveedor: mercancía + flete + seguro − pagado. Es lo
   *  que hay que girar ("Saldo Con freight" del Excel de Nico). */
  saldoUsd: number;
  /** Solo mercancía, sin flete ni seguro ("Balance no freight"). */
  saldoUsdMercancia: number;
  /** Flete + seguro pendientes incluidos en saldoUsd (0 si no hay). */
  fleteSeguroUsd: number;
  /** El saldo a la TRM simulada — la caja que falta para cerrar con China. */
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

/**
 * Viernes de liquidación aduanera para una fecha de arribo: la DIAN liquida
 * arancel e IVA a la TRM vigente, que es la certificada el ÚLTIMO VIERNES
 * previo a la semana del arribo (Nico 2026-09-03). Ej: arribo martes 02-sep
 * → viernes 29-ago. Si la fecha ya es lunes, igual retrocede al viernes
 * anterior. Devuelve YYYY-MM-DD (la TRM se busca con ≤ esa fecha, así un
 * viernes festivo cae al día hábil anterior solo).
 */
export function viernesAduana(fechaArribo: string | null | undefined): string | null {
  if (!fechaArribo) return null;
  const d = new Date(fechaArribo + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const desdeLunes = (d.getDay() + 6) % 7; // lunes=0 ... domingo=6
  d.setDate(d.getDate() - desdeLunes - 3); // lunes de esa semana − 3 = viernes previo
  return d.toISOString().slice(0, 10);
}

export function escenarioVigente(input: EscenarioVigenteInput): EscenarioVigente {
  const totalUsd = Math.max(0, n0(input.mercanciaUsd));
  const abonos = (input.abonos ?? []).filter((a) => n0(a.amount_usd) > 0 && n0(a.trm) > 0);
  const pagadoUsd = abonos.reduce((s, a) => s + n0(a.amount_usd), 0);
  const pagadoCop = abonos.reduce((s, a) => s + n0(a.amount_usd) * n0(a.trm), 0);
  const trmPonderadaPagado = pagadoUsd > 0 ? pagadoCop / pagadoUsd : null;
  // El saldo de Pedidos manda cuando está disponible (una sola fuente de
  // verdad); mercancía − pagado queda solo como fallback.
  const saldoUsdMercancia = input.saldoUsdReal != null && Number.isFinite(Number(input.saldoUsdReal))
    ? Math.max(0, Number(input.saldoUsdReal))
    : Math.max(0, totalUsd - pagadoUsd);
  // Flete y seguro se le giran al MISMO proveedor: son parte de lo que hay
  // que comprar en dólares, no un costo aparte que aparece después.
  const fleteSeguroUsd = Math.max(0, n0(input.fleteSeguroUsd));
  const saldoUsd = Math.max(0, saldoUsdMercancia + fleteSeguroUsd);
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
  if (fleteSeguroUsd > 0) {
    supuestos.push(`El saldo incluye flete y seguro (${Math.round(fleteSeguroUsd).toLocaleString('es-CO')} USD): se giran al mismo proveedor. Sin ellos serían ${Math.round(saldoUsdMercancia).toLocaleString('es-CO')} USD.`);
  }
  if (breakdown.pisoAplicado) {
    supuestos.push(`Impuestos liquidados sobre el piso FOB (${breakdown.pisoFobUsdKg} USD/kg): el precio real quedó por debajo.`);
  }
  if (trmAduana != null) {
    supuestos.push(`Arancel e IVA sobre la TRM de aduana (${Math.round(trmAduana).toLocaleString('es-CO')}) — la DIAN liquida a la TRM vigente, no al promedio que pagaste.`);
  }
  supuestos.push('Estimación para preparar caja — la liquidación real puede mover la TRM del día de nacionalización.');

  return {
    totalUsd, pagadoUsd, pagadoCop, trmPonderadaPagado,
    saldoUsd, saldoUsdMercancia, fleteSeguroUsd, saldoCopSimulado,
    breakdown, impuestosPendientesCop, cajaParaCerrarCop, supuestos,
  };
}
