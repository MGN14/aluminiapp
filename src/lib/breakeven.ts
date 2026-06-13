/**
 * Margen de contribución y punto de equilibrio.
 *
 * Margen de contribución (MC) = Ventas − Costos variables. Es lo que queda de
 * cada peso vendido para cubrir los costos fijos y dejar utilidad.
 * Ratio de contribución = MC / Ventas.
 * Punto de equilibrio ($) = Costos fijos / Ratio de contribución → cuánto hay
 * que vender para no ganar ni perder.
 * Margen de seguridad = cuánto por encima del punto de equilibrio estás
 * vendiendo (colchón antes de entrar en pérdida).
 *
 * Función pura → testeable.
 */

export interface BreakevenInput {
  ventas: number;
  costosVariables: number;
  costosFijos: number;
}

export interface BreakevenResult {
  margenContribucion: number;
  ratioContribucionPct: number | null;   // MC / ventas × 100
  puntoEquilibrio: number | null;         // ventas necesarias para utilidad 0
  utilidad: number;                       // MC − costos fijos
  margenSeguridadPct: number | null;      // (ventas − PE) / ventas × 100
  /** ventas por encima (o por debajo, negativo) del punto de equilibrio */
  excedenteVentas: number | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function computeBreakeven(input: BreakevenInput): BreakevenResult {
  const ventas = num(input.ventas);
  const cv = num(input.costosVariables);
  const cf = num(input.costosFijos);

  const mc = r2(ventas - cv);
  const ratio = ventas > 0 ? mc / ventas : null;     // 0-1
  // Si el ratio de contribución es <= 0 (los costos variables se comen toda la
  // venta), el punto de equilibrio no existe: nunca se cubren los fijos.
  const pe = ratio !== null && ratio > 0 ? r2(cf / ratio) : null;
  const utilidad = r2(mc - cf);
  const excedente = pe !== null ? r2(ventas - pe) : null;
  const margenSeguridad = pe !== null && ventas > 0 ? r2(((ventas - pe) / ventas) * 100) : null;

  return {
    margenContribucion: mc,
    ratioContribucionPct: ratio !== null ? r2(ratio * 100) : null,
    puntoEquilibrio: pe,
    utilidad,
    margenSeguridadPct: margenSeguridad,
    excedenteVentas: excedente,
  };
}
