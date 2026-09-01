/**
 * Escalar el packing a lo que la fábrica DESPACHÓ de verdad.
 *
 * Caso real (Nico 2026-08-31): "la china envió de más — no envió 28.400 sino
 * como 28.800 kg… lo importante es que la app tenga en cuenta unidades (el
 * prorrateo del flete es entre más unidades), lo mismo con el peso. Que el
 * usuario ponga esos datos y que la app sepa prorratear eso también, no como
 * que lo edites y ya."
 *
 * Exacto: corregir el TOTAL no alcanza. El flete se reparte por peso, el
 * arancel por valor y varios costos por cantidad — si llegan más unidades, el
 * flete unitario BAJA. La única forma de que eso salga bien es escalar el
 * packing y dejar que computeLandedCost vuelva a prorratear sobre la base
 * nueva. Cada dimensión se escala con SU propio factor:
 *
 *     fob_total_usd × (mercancía real / mercancía del packing)
 *     peso_kg       × (peso real      / peso del packing)
 *     cantidad      × (unidades reales/ unidades del packing)
 *
 * Si solo se conoce el peso (lo habitual: la báscula del puerto llega antes
 * que el packing detallado), las unidades se derivan proporcionalmente — el
 * mismo criterio que usaba el calculador HTML (`UNDS_DERIV`).
 */

import type { LandedItemInput } from '@/lib/landedCost';

export interface AjustePacking {
  /** Mercancía facturada real en USD (null = la del packing). */
  mercanciaUsd?: number | null;
  /** Peso real despachado en kg. */
  pesoKg?: number | null;
  /** Unidades reales despachadas. */
  unidades?: number | null;
  /** Si solo hay peso, derivar las unidades proporcionalmente. Default true. */
  derivarUnidades?: boolean;
}

export interface PackingTotales {
  mercanciaUsd: number;
  pesoKg: number;
  unidades: number;
}

export interface ScaleResult {
  items: LandedItemInput[];
  base: PackingTotales;
  efectivo: PackingTotales;
  factores: { valor: number; peso: number; cantidad: number };
  /** true si algún factor ≠ 1 (o sea, el packing se escaló). */
  escalado: boolean;
}

export function totalesDe(items: LandedItemInput[]): PackingTotales {
  return {
    mercanciaUsd: items.reduce((s, it) => s + (Number(it.fob_total_usd) || 0), 0),
    pesoKg: items.reduce((s, it) => s + (Number(it.peso_kg) || 0), 0),
    unidades: items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0),
  };
}

const factor = (real: number | null | undefined, base: number): number => {
  const r = Number(real);
  return Number.isFinite(r) && r > 0 && base > 0 ? r / base : 1;
};

export function scalePacking(items: LandedItemInput[], ajuste: AjustePacking): ScaleResult {
  const base = totalesDe(items);
  const derivar = ajuste.derivarUnidades !== false;

  const fValor = factor(ajuste.mercanciaUsd, base.mercanciaUsd);
  const fPeso = factor(ajuste.pesoKg, base.pesoKg);
  // Sin unidades explícitas: si el peso cambió, las unidades lo siguen —
  // la fábrica despachó más piezas, no piezas más pesadas.
  const fCantidad = ajuste.unidades != null && Number(ajuste.unidades) > 0
    ? factor(ajuste.unidades, base.unidades)
    : (derivar ? fPeso : 1);

  const escalado = fValor !== 1 || fPeso !== 1 || fCantidad !== 1;
  if (!escalado) {
    return { items, base, efectivo: base, factores: { valor: 1, peso: 1, cantidad: 1 }, escalado: false };
  }

  const scaled = items.map((it) => ({
    ...it,
    fob_total_usd: (Number(it.fob_total_usd) || 0) * fValor,
    peso_kg: it.peso_kg == null ? null : (Number(it.peso_kg) || 0) * fPeso,
    cantidad: (Number(it.cantidad) || 0) * fCantidad,
  }));

  return {
    items: scaled,
    base,
    efectivo: totalesDe(scaled),
    factores: { valor: fValor, peso: fPeso, cantidad: fCantidad },
    escalado: true,
  };
}
