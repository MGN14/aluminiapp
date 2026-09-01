/**
 * "De dónde sale la diferencia" — descomposición de la diferencia de costo
 * entre dos contenedores en sus drivers (port del bloque estrella del
 * Calculador HTML de Nico, generalizado a cualquier par).
 *
 *   Δtotal = ΔSMM + Δpeso + ΔTRM + Δflete + residual
 *
 *   ΔSMM   = (smm_v − smm_m) × tons_v × trm_m      — el aluminio
 *   Δpeso  = (tons_v − tons_m) × smm_m × trm_m     — tamaño del pedido
 *   ΔTRM   = (trm_v − trm_m) × usd_total_v         — el dólar
 *   Δflete = (flete_v − flete_m) × trm_m
 *   residual = Δtotal − Σ                           — arancel, fijos, cruces
 *
 * El residual absorbe lo que no explican los cuatro efectos puros (los
 * términos cruzados y los cambios de arancel/fijos): por construcción los
 * drivers SIEMPRE suman exacto la diferencia — un desglose que no suma no
 * sirve para decidir. Test lo garantiza.
 */

export interface LadoDriver {
  totalCop: number;
  /** SMM cerrado USD/ton (sin prima). */
  smmUsdTon: number | null;
  tons: number | null;
  /** TRM efectiva del lado (ponderada real o mixta simulada). */
  trm: number | null;
  fleteUsd: number | null;
  /** USD totales que giran (mercancía + flete + seguro). */
  usdTotal: number | null;
}

export interface Driver {
  key: 'smm' | 'peso' | 'trm' | 'flete' | 'residual';
  label: string;
  cop: number;
  detalle: string;
}

export interface DriversResult {
  deltaTotalCop: number;
  deltaPctTotal: number | null;
  drivers: Driver[];
}

const f0 = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n));

export function driversDelta(molde: LadoDriver, vigente: LadoDriver): DriversResult {
  const deltaTotalCop = vigente.totalCop - molde.totalCop;
  const deltaPctTotal = molde.totalCop !== 0 ? (deltaTotalCop / molde.totalCop) * 100 : null;

  const drivers: Driver[] = [];

  if (vigente.smmUsdTon != null && molde.smmUsdTon != null && vigente.tons != null && molde.trm != null) {
    drivers.push({
      key: 'smm', label: 'Aluminio (SMM)',
      cop: (vigente.smmUsdTon - molde.smmUsdTon) * vigente.tons * molde.trm,
      detalle: `${f0(molde.smmUsdTon)} → ${f0(vigente.smmUsdTon)} USD/ton`,
    });
  }
  if (vigente.tons != null && molde.tons != null && molde.smmUsdTon != null && molde.trm != null) {
    drivers.push({
      key: 'peso', label: 'Tamaño del pedido',
      cop: (vigente.tons - molde.tons) * molde.smmUsdTon * molde.trm,
      detalle: `${f0(molde.tons * 1000)} → ${f0(vigente.tons * 1000)} kg`,
    });
  }
  if (vigente.trm != null && molde.trm != null && vigente.usdTotal != null) {
    drivers.push({
      key: 'trm', label: 'Dólar (TRM)',
      cop: (vigente.trm - molde.trm) * vigente.usdTotal,
      detalle: `${f0(molde.trm)} → ${f0(vigente.trm)} efectiva`,
    });
  }
  if (vigente.fleteUsd != null && molde.fleteUsd != null && molde.trm != null) {
    drivers.push({
      key: 'flete', label: 'Flete',
      cop: (vigente.fleteUsd - molde.fleteUsd) * molde.trm,
      detalle: `${f0(molde.fleteUsd)} → ${f0(vigente.fleteUsd)} USD`,
    });
  }
  // El residual cierra la cuenta: Δtotal − lo explicado por los 4 efectos.
  const explicado = drivers.reduce((s, d) => s + d.cop, 0);
  drivers.push({
    key: 'residual', label: 'Arancel + fijos + cruces',
    cop: deltaTotalCop - explicado,
    detalle: 'lo que no explican los 4 de arriba',
  });

  return { deltaTotalCop, deltaPctTotal, drivers };
}
