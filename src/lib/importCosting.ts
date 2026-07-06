/**
 * Costeo de una importación a partir de sus costos cargados (import_costs).
 *
 * Única fuente de verdad del desglose que se muestra en el Resumen del pedido,
 * en las columnas de la lista y en los KPIs de materia prima:
 *   CIF USD  = mercancía + flete + seguro (en USD)
 *   CIF COP  = CIF USD × TRM + flete/seguro denominados en COP
 *   Arancel  = real cargado si existe; si no, CIF COP × arancel_pct
 *   IVA      = real cargado si existe; si no, (CIF + arancel) × iva_pct
 *   Otros    = agencia/nacionalización + gastos bancarios + otros
 *   Total Importación = CIF COP + arancel + IVA + otros
 */

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
}

export function computeImportBreakdown(params: {
  mercanciaUsd: number;
  costs: ImportCostLine[] | undefined;
  trm: number | null;
  arancelPct: number;
  ivaPct: number;
}): ImportBreakdown {
  const { mercanciaUsd, costs, arancelPct, ivaPct } = params;
  const trm = Number(params.trm) > 0 ? Number(params.trm) : null;

  const flete = sumImportCosts(costs, 'flete');
  const seguro = sumImportCosts(costs, 'seguro');
  const arancelReal = sumImportCosts(costs, 'arancel');
  const ivaReal = sumImportCosts(costs, 'iva_importacion');
  const agencia = sumImportCosts(costs, 'nacionalizacion');
  const bancarios = sumImportCosts(costs, 'gastos_bancarios');
  const otros = sumImportCosts(costs, 'otro');

  const cifUsd = mercanciaUsd + flete.usd + seguro.usd;
  const cifCop = trm ? cifUsd * trm + flete.cop + seguro.cop : null;

  const arancelRealCop = (trm ? arancelReal.usd * trm : 0) + arancelReal.cop;
  const usaArancelReal = arancelRealCop > 0;
  const arancelCop = usaArancelReal
    ? arancelRealCop
    : cifCop != null ? cifCop * (arancelPct / 100) : null;

  const ivaRealCop = (trm ? ivaReal.usd * trm : 0) + ivaReal.cop;
  const usaIvaReal = ivaRealCop > 0;
  const ivaCop = usaIvaReal
    ? ivaRealCop
    : cifCop != null && arancelCop != null ? (cifCop + arancelCop) * (ivaPct / 100) : null;

  const otrosCop = (trm ? (agencia.usd + bancarios.usd + otros.usd) * trm : 0)
    + agencia.cop + bancarios.cop + otros.cop;

  const totalImportacionCop = cifCop != null && arancelCop != null && ivaCop != null
    ? cifCop + arancelCop + ivaCop + otrosCop
    : null;

  return { flete, seguro, cifUsd, cifCop, arancelCop, usaArancelReal, ivaCop, usaIvaReal, otrosCop, totalImportacionCop };
}
