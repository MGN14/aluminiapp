/**
 * Costeo de una importación a partir de sus costos cargados (import_costs).
 *
 * Única fuente de verdad del desglose que se muestra en el Resumen del pedido,
 * en las columnas de la lista y en los KPIs de materia prima:
 *   CIF USD  = mercancía + flete + seguro (en USD)
 *   CIF COP  = CIF USD × TRM + flete/seguro denominados en COP
 *   Arancel  = real cargado si existe; si no, CIF aduana COP × arancel_pct
 *   IVA      = real cargado si existe; si no, (CIF aduana + arancel) × iva_pct
 *   Otros    = agencia/nacionalización + gastos bancarios + otros
 *   Total Importación = CIF COP + arancel + IVA + otros
 *
 * PISO FOB (precio mínimo aduanero): para perfiles de aluminio rige un umbral
 * de 4,13 USD/kg FOB. Si el precio real del pedido queda por debajo (pasa
 * cuando el SMM baja), la DIAN liquida arancel e IVA sobre la base mínima
 * (4,13 × kg), NO sobre el valor factura. Por eso la ESTIMACIÓN de impuestos
 * usa "CIF aduana" (mercancía flooreada + flete + seguro) mientras el CIF
 * real (lo que efectivamente se paga al proveedor) sigue intacto en el total.
 * Los valores reales cargados en import_costs siempre mandan sobre estimados.
 */

/** Umbral legal FOB para perfiles de aluminio (USD por kg). */
export const PISO_FOB_ALUMINIO_USD_KG = 4.13;

export interface ImportCostLine {
  tipo: string;
  monto: number;
  moneda: 'USD' | 'COP';
}

/** Suma de costos de un tipo, separada por moneda. */
export function sumImportCosts(
  costs: ImportCostLine[] | undefined,
  tipo: string,
): { usd: number; cop: number } {
  let usd = 0;
  let cop = 0;
  for (const c of costs ?? []) {
    if (c.tipo !== tipo) continue;
    if (c.moneda === 'USD') usd += Number(c.monto ?? 0);
    else cop += Number(c.monto ?? 0);
  }
  return { usd, cop };
}

export interface ImportBreakdown {
  flete: { usd: number; cop: number };
  seguro: { usd: number; cop: number };
  cifUsd: number;
  /** null si no hay TRM para convertir */
  cifCop: number | null;
  arancelCop: number | null;
  /** true = hay arancel real cargado en costos (manda sobre el estimado) */
  usaArancelReal: boolean;
  ivaCop: number | null;
  usaIvaReal: boolean;
  otrosCop: number;
  totalImportacionCop: number | null;
  /** Precio FOB efectivo del pedido (USD/kg); null si no se pasó cantidad. */
  fobUsdKg: number | null;
  /** true = el FOB real quedó bajo el piso legal → los impuestos ESTIMADOS
   *  se calcularon sobre la base mínima (piso × kg), no sobre el valor factura. */
  pisoAplicado: boolean;
  /** Piso usado (USD/kg), para mostrar en UI. */
  pisoFobUsdKg: number;
  /** CIF COP usado como base de arancel/IVA estimados (≥ cifCop si hay piso). */
  cifAduanaCop: number | null;
}

export function computeImportBreakdown(params: {
  mercanciaUsd: number;
  costs: ImportCostLine[] | undefined;
  trm: number | null;
  arancelPct: number;
  ivaPct: number;
  /** Peso del pedido en kg. Si se pasa, se aplica el piso FOB aduanero a la
   *  estimación de impuestos cuando el precio real queda por debajo. */
  cantidadKg?: number | null;
  /** Override del umbral (default: piso legal perfiles de aluminio). */
  pisoFobUsdKg?: number;
}): ImportBreakdown {
  const { mercanciaUsd, costs, arancelPct, ivaPct } = params;
  const trm = Number(params.trm) > 0 ? Number(params.trm) : null;
  const cantidadKg = Number(params.cantidadKg) > 0 ? Number(params.cantidadKg) : null;
  const pisoFobUsdKg = params.pisoFobUsdKg ?? PISO_FOB_ALUMINIO_USD_KG;

  const flete = sumImportCosts(costs, 'flete');
  const seguro = sumImportCosts(costs, 'seguro');
  const arancelReal = sumImportCosts(costs, 'arancel');
  const ivaReal = sumImportCosts(costs, 'iva_importacion');
  const agencia = sumImportCosts(costs, 'nacionalizacion');
  const bancarios = sumImportCosts(costs, 'gastos_bancarios');
  const otros = sumImportCosts(costs, 'otro');

  const cifUsd = mercanciaUsd + flete.usd + seguro.usd;
  const cifCop = trm ? cifUsd * trm + flete.cop + seguro.cop : null;

  // Piso FOB: si el precio real por kg quedó bajo el umbral, la aduana liquida
  // sobre la base mínima. Solo afecta la BASE de los impuestos estimados —
  // el CIF real (lo pagado al proveedor) no cambia.
  const fobUsdKg = cantidadKg && mercanciaUsd > 0 ? mercanciaUsd / cantidadKg : null;
  const pisoAplicado = fobUsdKg != null && fobUsdKg < pisoFobUsdKg;
  const mercanciaAduanaUsd = pisoAplicado ? pisoFobUsdKg * cantidadKg! : mercanciaUsd;
  const cifAduanaUsd = mercanciaAduanaUsd + flete.usd + seguro.usd;
  const cifAduanaCop = trm ? cifAduanaUsd * trm + flete.cop + seguro.cop : null;

  const arancelRealCop = (trm ? arancelReal.usd * trm : 0) + arancelReal.cop;
  const usaArancelReal = arancelRealCop > 0;
  const arancelCop = usaArancelReal
    ? arancelRealCop
    : cifAduanaCop != null ? cifAduanaCop * (arancelPct / 100) : null;

  const ivaRealCop = (trm ? ivaReal.usd * trm : 0) + ivaReal.cop;
  const usaIvaReal = ivaRealCop > 0;
  const ivaCop = usaIvaReal
    ? ivaRealCop
    : cifAduanaCop != null && arancelCop != null ? (cifAduanaCop + arancelCop) * (ivaPct / 100) : null;

  const otrosCop = (trm ? (agencia.usd + bancarios.usd + otros.usd) * trm : 0)
    + agencia.cop + bancarios.cop + otros.cop;

  // El total suma el CIF REAL (lo que efectivamente sale de caja hacia el
  // proveedor) + impuestos (que sí se liquidan sobre la base flooreada).
  const totalImportacionCop = cifCop != null && arancelCop != null && ivaCop != null
    ? cifCop + arancelCop + ivaCop + otrosCop
    : null;

  return {
    flete, seguro, cifUsd, cifCop, arancelCop, usaArancelReal, ivaCop, usaIvaReal,
    otrosCop, totalImportacionCop, fobUsdKg, pisoAplicado, pisoFobUsdKg, cifAduanaCop,
  };
}
