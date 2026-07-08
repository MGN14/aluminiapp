/**
 * Comparación PROFORMA vs PACKING LIST definitivo, agrupada por familia de
 * referencias (la "-5": base + colores suman juntos — ver refFamily.ts).
 *
 * El proforma es lo que se pidió a producción; el packing list es lo que
 * realmente viene en el contenedor. SIEMPRE difieren un poco — esta tabla
 * muestra exactamente dónde y cuánto, antes de que el contenedor llegue.
 */

import { refFamilyKey } from '@/lib/refFamily';

export interface CompareInputItem {
  reference: string;
  cantidad: number;
  peso_kg?: number | null;
}

export interface FamilyComparison {
  /** Llave de familia (base normalizada). */
  familia: string;
  /** Etiqueta para mostrar (la referencia tal como vino, la más larga). */
  label: string;
  proformaCant: number;
  packingCant: number;
  deltaCant: number;
  proformaKg: number;
  packingKg: number;
  deltaKg: number;
  /** 'solo_proforma' = pedida y no embarcada · 'solo_packing' = vino sin pedirse */
  estado: 'igual' | 'difiere' | 'solo_proforma' | 'solo_packing';
}

export interface PackingCompareResult {
  familias: FamilyComparison[];
  /** Solo las que difieren (incluye solo_proforma / solo_packing). */
  conDiferencia: FamilyComparison[];
  totales: {
    proformaCant: number;
    packingCant: number;
    deltaCant: number;
    proformaKg: number;
    packingKg: number;
    deltaKg: number;
  };
}

interface Acc { label: string; cant: number; kg: number }

function groupByFamily(items: CompareInputItem[]): Map<string, Acc> {
  const m = new Map<string, Acc>();
  for (const it of items) {
    const key = refFamilyKey(it.reference);
    if (!key) continue;
    const acc = m.get(key) ?? { label: it.reference.trim(), cant: 0, kg: 0 };
    acc.cant += Number(it.cantidad ?? 0);
    acc.kg += Number(it.peso_kg ?? 0);
    // Etiqueta: preferir la referencia más "completa" (con sufijo) si aparece.
    if (it.reference.trim().length > acc.label.length) acc.label = it.reference.trim();
    m.set(key, acc);
  }
  return m;
}

export function comparePackingVsProforma(
  proforma: CompareInputItem[],
  packing: CompareInputItem[],
): PackingCompareResult {
  const pro = groupByFamily(proforma);
  const pack = groupByFamily(packing);
  const keys = new Set([...pro.keys(), ...pack.keys()]);

  const familias: FamilyComparison[] = [];
  for (const key of keys) {
    const a = pro.get(key);
    const b = pack.get(key);
    const proformaCant = a?.cant ?? 0;
    const packingCant = b?.cant ?? 0;
    const proformaKg = a?.kg ?? 0;
    const packingKg = b?.kg ?? 0;
    const estado: FamilyComparison['estado'] =
      !a ? 'solo_packing'
      : !b ? 'solo_proforma'
      : proformaCant !== packingCant ? 'difiere'
      : 'igual';
    familias.push({
      familia: key,
      label: (b ?? a)!.label,
      proformaCant,
      packingCant,
      deltaCant: packingCant - proformaCant,
      proformaKg,
      packingKg,
      deltaKg: packingKg - proformaKg,
      estado,
    });
  }

  // Orden: las diferencias más grandes primero (en unidades absolutas).
  familias.sort((x, y) => Math.abs(y.deltaCant) - Math.abs(x.deltaCant) || x.familia.localeCompare(y.familia));

  const sum = (f: (c: FamilyComparison) => number) => familias.reduce((s, c) => s + f(c), 0);
  return {
    familias,
    conDiferencia: familias.filter((f) => f.estado !== 'igual'),
    totales: {
      proformaCant: sum((c) => c.proformaCant),
      packingCant: sum((c) => c.packingCant),
      deltaCant: sum((c) => c.deltaCant),
      proformaKg: sum((c) => c.proformaKg),
      packingKg: sum((c) => c.packingKg),
      deltaKg: sum((c) => c.deltaKg),
    },
  };
}
