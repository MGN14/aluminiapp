/**
 * Colores de gráficas — método dataviz (2026-09-17).
 *
 * Los valores viven en index.css como `--viz-*` (claro y oscuro, validados con
 * validate_palette.js: banda de luminosidad, croma, separación CVD ≥ 8 en
 * pares adyacentes, piso visión normal ≥ 15, contraste). Acá solo hay ROLES:
 *  - categórico: 8 slots en orden FIJO, asignados en secuencia, nunca ciclados;
 *    un 9º se pliega en "Otros" (gris).
 *  - ingreso / egreso: par verde/rojo del sistema (CVD ΔE 7,2 → siempre con
 *    leyenda + tooltip + vista tabla como codificación secundaria).
 *  - ordinal: una sola tonalidad (azul) de claro a oscuro para escalas con
 *    orden (edades de cartera).
 * El color sigue a la ENTIDAD, no a su ranking: ver stableSeriesColors.
 */

/** Slot categórico 1..8 (orden fijo). Más allá de 8 → gris "Otros". */
export function seriesColor(index: number): string {
  return index >= 0 && index < 8 ? `var(--viz-${index + 1})` : 'var(--viz-neutral)';
}

export const CHART_COLORS = {
  income: 'var(--viz-income)',
  expense: 'var(--viz-expense)',
  /** Líneas de promedio: misma tonalidad, se distinguen por el trazo punteado. */
  incomeAvg: 'var(--viz-income)',
  expenseAvg: 'var(--viz-expense)',
  neutral: 'var(--viz-neutral)',
  /** Proyección / referencia (slot 1, azul). */
  projection: 'var(--viz-1)',
  grid: 'var(--viz-grid)',
  axis: 'var(--viz-axis)',
  inkMuted: 'var(--viz-ink-muted)',
};

/** Rampa ordinal (5 pasos, claro → oscuro): corriente → +90 días. */
export const ORDINAL_RAMP = ['var(--viz-ord-1)', 'var(--viz-ord-2)', 'var(--viz-ord-3)', 'var(--viz-ord-4)', 'var(--viz-ord-5)'];

/**
 * Categorías de egreso: cada una tiene su slot FIJO (el color sigue a la
 * categoría aunque cambie su ranking o el Top N). Las tres que casi siempre
 * dominan (proveedores, impuestos, nómina) ocupan los slots 1-3, que validan
 * incluso en todos-los-pares. Lo neutro (transferencias, otros, sin
 * categoría) es gris: no compite por identidad.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  proveedores: seriesColor(0),
  impuestos: seriesColor(1),
  nomina: seriesColor(2),
  gastos_operativos: seriesColor(6),
  servicios: seriesColor(3),
  gastos_de_representacion: seriesColor(4),
  ventas: 'var(--viz-income)',
  transferencias: 'var(--viz-neutral)',
  otros: 'var(--viz-neutral)',
  sin_categoria: 'var(--viz-neutral)',
  default: 'var(--viz-neutral)',
};

export const OPERATIONAL_TYPE_COLORS: Record<string, string> = {
  ingreso: 'var(--viz-income)',
  costo: 'var(--viz-expense)',
  gasto_operativo: seriesColor(1),
  impuesto: seriesColor(6),
  transferencia: 'var(--viz-neutral)',
  ajuste: seriesColor(0),
  otros: 'var(--viz-neutral)',
};

/** Orden fijo para series de clientes / facturas (8 slots). */
export const INVOICE_SERIES_COLORS = [0, 1, 2, 3, 4, 5, 6, 7].map(seriesColor);

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function getCategoryColor(category: string): string {
  const normalized = stripAccents(category).toLowerCase().trim().replace(/\s+/g, '_');
  return CATEGORY_COLORS[normalized] || CATEGORY_COLORS.default;
}

export function getCategoryColorsArray(categories: string[]): string[] {
  return categories.map(cat => getCategoryColor(cat));
}

/**
 * Asigna un slot por ENTIDAD de forma estable: el ranking global (todas las
 * entidades ordenadas por su valor total) fija el slot; filtrar a Top 3 o Top
 * 10 no repinta a los que quedan. `other` (ej. "Otros") siempre es gris.
 */
export function stableSeriesColors(rankedNames: string[], other = 'Otros'): (name: string) => string {
  const slotOf = new Map<string, number>();
  rankedNames.forEach((n, i) => { if (!slotOf.has(n)) slotOf.set(n, i); });
  return (name: string) => {
    if (name === other) return 'var(--viz-neutral)';
    const i = slotOf.get(name);
    return i == null ? 'var(--viz-neutral)' : seriesColor(i);
  };
}
