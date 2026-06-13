/**
 * Cálculo de landed cost (costo nacionalizado) referencia a referencia.
 *
 * El costo real de cada referencia importada NO es solo el FOB: hay que
 * sumarle la parte proporcional de flete, seguro, arancel, IVA de importación,
 * nacionalización y gastos bancarios, y convertir todo a COP a la TRM real
 * (ponderada de los abonos del pedido).
 *
 * Prorrateo híbrido: cada costo se reparte sobre las referencias según su
 * `base_asignacion`:
 *   - 'peso'     → proporcional al peso_kg de cada ítem (flete, nacionalización)
 *   - 'valor'    → proporcional al fob_total_usd (arancel ad-valorem, seguro)
 *   - 'cantidad' → proporcional a la cantidad de unidades
 *
 * Función pura y determinística → fácil de testear y de auditar.
 */

export type AllocationBasis = 'peso' | 'valor' | 'cantidad';
export type ImportCostTipo =
  | 'flete' | 'seguro' | 'arancel' | 'iva_importacion'
  | 'nacionalizacion' | 'gastos_bancarios' | 'otro';

export interface LandedItemInput {
  id: string;
  reference: string;
  descripcion?: string | null;
  cantidad: number;
  unidad: string;
  peso_kg: number | null;
  fob_total_usd: number;
}

export interface LandedCostInput {
  id: string;
  tipo: ImportCostTipo;
  concepto?: string | null;
  monto: number;
  moneda: 'USD' | 'COP';
  trm: number | null;          // null → usar trmPonderada
  base_asignacion: AllocationBasis;
}

export interface LandedItemResult {
  id: string;
  reference: string;
  descripcion: string | null;
  cantidad: number;
  unidad: string;
  peso_kg: number | null;
  fob_total_usd: number;
  fob_total_cop: number;
  /** Costos adicionales prorrateados a esta referencia, en COP */
  costos_asignados_cop: number;
  /** FOB + costos asignados, en COP */
  landed_total_cop: number;
  /** landed_total_cop / cantidad */
  landed_unit_cop: number;
  /** landed_total_cop / peso_kg (null si no hay peso) */
  landed_por_kg_cop: number | null;
  /** % que pesa esta referencia sobre el total del pedido (por valor landed) */
  pct_del_pedido: number;
}

export interface LandedCostResult {
  items: LandedItemResult[];
  /** TRM efectiva usada para convertir USD→COP cuando el costo no trae TRM propia */
  trmUsada: number;
  /** IDs de costos cuya base de prorrateo elegida sumaba 0 y se repartieron con
   *  un fallback (cantidad → valor → peso → partes iguales). La UI avisa. */
  fallbackCostIds: string[];
  totals: {
    fob_total_usd: number;
    fob_total_cop: number;
    costos_total_cop: number;
    landed_total_cop: number;
    peso_total_kg: number;
    cantidad_total: number;
    /** Desglose de costos por tipo, en COP (para el gráfico de composición) */
    costos_por_tipo: Record<string, number>;
    /** % del landed total que es FOB vs costos de importación */
    pct_fob: number;
    pct_costos: number;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function basisWeight(item: LandedItemInput, basis: AllocationBasis): number {
  switch (basis) {
    case 'peso':
      return Number(item.peso_kg) || 0;
    case 'cantidad':
      return Number(item.cantidad) || 0;
    case 'valor':
    default:
      return Number(item.fob_total_usd) || 0;
  }
}

/**
 * @param items     ítems del packing list
 * @param costs     costos adicionales del pedido
 * @param trmPonderada TRM ponderada de los abonos (imports_liquidation). Si no
 *                  hay abonos aún, el caller pasa una TRM de referencia (ej. la
 *                  TRM del día o la del último abono). Debe ser > 0 para
 *                  convertir USD→COP; si es 0/nulo, los montos USD quedan en 0
 *                  COP y se marca trmUsada=0 para que la UI avise.
 */
export function computeLandedCost(
  items: LandedItemInput[],
  costs: LandedCostInput[],
  trmPonderada: number | null,
): LandedCostResult {
  const trmUsada = Number(trmPonderada) > 0 ? Number(trmPonderada) : 0;

  const nItems = items.length;

  // Pre-sumas de cada base para repartir proporcionalmente.
  const sumByBasis: Record<AllocationBasis, number> = {
    peso: items.reduce((s, it) => s + basisWeight(it, 'peso'), 0),
    valor: items.reduce((s, it) => s + basisWeight(it, 'valor'), 0),
    cantidad: items.reduce((s, it) => s + basisWeight(it, 'cantidad'), 0),
  };

  // Base efectiva de un costo: si la base elegida suma 0 (ningún ítem tiene
  // peso, p.ej.), caemos a otra base con datos en vez de DESCARTAR el costo
  // (lo que rompía el cuadre FOB + Importación = Landed). Orden de fallback:
  // cantidad → valor → peso → partes iguales.
  const fallbackCostIds: string[] = [];
  const effectiveBasis = (c: LandedCostInput): AllocationBasis | 'equal' => {
    if (sumByBasis[c.base_asignacion] > 0) return c.base_asignacion;
    fallbackCostIds.push(c.id);
    if (sumByBasis.cantidad > 0) return 'cantidad';
    if (sumByBasis.valor > 0) return 'valor';
    if (sumByBasis.peso > 0) return 'peso';
    return 'equal';
  };

  // Monto de cada costo convertido a COP + su base efectiva.
  const costsCop = costs.map((c) => {
    const monto = Number(c.monto) || 0;
    const montoCop = c.moneda === 'COP'
      ? r2(monto)
      : r2(monto * (Number(c.trm) > 0 ? Number(c.trm) : trmUsada));
    return { ...c, montoCop, basis: effectiveBasis(c) };
  });

  const costos_por_tipo: Record<string, number> = {};
  for (const c of costsCop) {
    costos_por_tipo[c.tipo] = r2((costos_por_tipo[c.tipo] || 0) + c.montoCop);
  }

  const itemResults: LandedItemResult[] = items.map((it) => {
    const fobCop = r2((Number(it.fob_total_usd) || 0) * trmUsada);
    // Sumar la fracción de cada costo que le toca a este ítem según su base.
    let asignados = 0;
    for (const c of costsCop) {
      let share: number;
      if (c.basis === 'equal') {
        share = nItems > 0 ? 1 / nItems : 0;
      } else {
        const totalBase = sumByBasis[c.basis];
        share = totalBase > 0 ? basisWeight(it, c.basis) / totalBase : 0;
      }
      asignados += c.montoCop * share;
    }
    asignados = r2(asignados);
    const landedTotal = r2(fobCop + asignados);
    const cantidad = Number(it.cantidad) || 0;
    const peso = Number(it.peso_kg) || 0;
    return {
      id: it.id,
      reference: it.reference,
      descripcion: it.descripcion ?? null,
      cantidad,
      unidad: it.unidad,
      peso_kg: it.peso_kg,
      fob_total_usd: r2(Number(it.fob_total_usd) || 0),
      fob_total_cop: fobCop,
      costos_asignados_cop: asignados,
      landed_total_cop: landedTotal,
      landed_unit_cop: cantidad > 0 ? r2(landedTotal / cantidad) : 0,
      landed_por_kg_cop: peso > 0 ? r2(landedTotal / peso) : null,
      pct_del_pedido: 0, // se completa abajo cuando tenemos el total
    };
  });

  // Totales reconciliados DESDE los ítems para que siempre cuadre
  // FOB + Importación = Landed (sin drift por redondeo ni costos evaporados).
  const fobTotalUsd = r2(items.reduce((s, it) => s + (Number(it.fob_total_usd) || 0), 0));
  const fobTotalCop = r2(itemResults.reduce((s, r) => s + r.fob_total_cop, 0));
  const costosTotalCop = r2(itemResults.reduce((s, r) => s + r.costos_asignados_cop, 0));
  const landedTotalCop = r2(fobTotalCop + costosTotalCop);

  for (const r of itemResults) {
    r.pct_del_pedido = landedTotalCop > 0 ? r2((r.landed_total_cop / landedTotalCop) * 100) : 0;
  }

  return {
    items: itemResults,
    trmUsada,
    fallbackCostIds,
    totals: {
      fob_total_usd: fobTotalUsd,
      fob_total_cop: fobTotalCop,
      costos_total_cop: costosTotalCop,
      landed_total_cop: landedTotalCop,
      peso_total_kg: r2(sumByBasis.peso),
      cantidad_total: r2(sumByBasis.cantidad),
      costos_por_tipo,
      pct_fob: landedTotalCop > 0 ? r2((fobTotalCop / landedTotalCop) * 100) : 0,
      pct_costos: landedTotalCop > 0 ? r2((costosTotalCop / landedTotalCop) * 100) : 0,
    },
  };
}

export const COST_TIPO_LABEL: Record<ImportCostTipo, string> = {
  flete: 'Flete internacional',
  seguro: 'Seguro',
  arancel: 'Arancel',
  iva_importacion: 'IVA de importación',
  nacionalizacion: 'Nacionalización / aduana',
  gastos_bancarios: 'Gastos bancarios',
  otro: 'Otro',
};

/** Base de prorrateo por defecto, contablemente sensata, para cada tipo. */
export const DEFAULT_BASIS_BY_TIPO: Record<ImportCostTipo, AllocationBasis> = {
  flete: 'peso',
  nacionalizacion: 'peso',
  gastos_bancarios: 'valor',
  arancel: 'valor',
  seguro: 'valor',
  iva_importacion: 'valor',
  otro: 'peso',
};

export const BASIS_LABEL: Record<AllocationBasis, string> = {
  peso: 'Por peso (kg)',
  valor: 'Por valor FOB',
  cantidad: 'Por cantidad',
};
