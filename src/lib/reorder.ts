/**
 * Alertas de reorden de inventario: detecta referencias cuyo stock cayó al
 * nivel mínimo (o por debajo) y sugiere cuánto reponer.
 *
 * Solo consideramos productos con min_stock > 0 (el usuario definió un punto de
 * reorden). Sugerencia de cantidad = reponer hasta `targetFactor × min_stock`
 * (por defecto 2×, un colchón razonable). Función pura → testeable.
 */

export type ReorderLevel = 'quiebre' | 'critico' | 'bajo';

export interface ReorderInput {
  reference: string;
  name: string;
  unit: string;
  stock_system: number;
  min_stock: number;
  cost_per_unit: number;
}

export interface ReorderItem {
  reference: string;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
  faltante: number;          // min_stock − stock (>= 0)
  cantidadSugerida: number;  // reponer hasta targetFactor × min_stock
  costoReposicion: number;   // cantidadSugerida × costo unitario
  nivel: ReorderLevel;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const RANK: Record<ReorderLevel, number> = { quiebre: 0, critico: 1, bajo: 2 };

export function computeReorder(products: ReorderInput[], targetFactor = 2): ReorderItem[] {
  const items: ReorderItem[] = [];
  for (const p of products) {
    const min = num(p.min_stock);
    if (min <= 0) continue;                 // sin punto de reorden definido
    const stock = num(p.stock_system);
    if (stock > min) continue;              // por encima del mínimo → ok

    const nivel: ReorderLevel = stock <= 0 ? 'quiebre' : stock < min ? 'critico' : 'bajo';
    const objetivo = min * targetFactor;
    const cantidadSugerida = Math.max(0, Math.ceil(objetivo - stock));
    items.push({
      reference: p.reference,
      name: p.name,
      unit: p.unit,
      stock,
      min_stock: min,
      faltante: Math.max(0, min - stock),
      cantidadSugerida,
      costoReposicion: Math.round(cantidadSugerida * num(p.cost_per_unit)),
      nivel,
    });
  }
  // Más crítico primero; dentro del nivel, mayor faltante primero.
  return items.sort((a, b) => RANK[a.nivel] - RANK[b.nivel] || b.faltante - a.faltante);
}

export function reorderTotals(items: ReorderItem[]) {
  return {
    count: items.length,
    quiebres: items.filter((i) => i.nivel === 'quiebre').length,
    costoTotal: items.reduce((s, i) => s + i.costoReposicion, 0),
  };
}
