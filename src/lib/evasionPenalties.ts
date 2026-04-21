/**
 * evasionPenalties — Estima cuánto te costaría la DIAN si te auditan por la
 * brecha medida en evasionGap.ts.
 *
 * Fuentes normativas (Colombia, vigentes 2026):
 *   - Art 648 ET: Sanción por inexactitud = 100% del mayor valor del impuesto
 *     a cargo determinado oficialmente por la DIAN (reformado por Ley 1819/2016;
 *     puede llegar a 200% por reincidencia).
 *   - Art 635 ET: Intereses moratorios a la tasa de usura menos dos puntos,
 *     certificada por la Superfinanciera. Aproximación 2026: ~24% anual E.A.
 *   - Art 402 Código Penal: Omisión del agente retenedor o responsable del IVA
 *     > 250 SMLMV/año ⇒ prisión 48–108 meses + multa.
 *   - Art 434A CP: Fraude fiscal > 250 SMLMV/año ⇒ prisión 48–108 meses.
 *
 * Estas tasas son aproximaciones educativas. El objetivo es demostrarle al
 * usuario que el "ahorro" de evadir rara vez compensa el riesgo real.
 *
 * Diseño: función pura, sin dependencias de UI ni Supabase.
 */

/** Tasas y umbrales DIAN. Editables si el producto cambia de criterio. */
export const DIAN_RATES = {
  /** IVA general Colombia (2026) */
  iva: 0.19,
  /** Renta persona jurídica (2026) */
  renta: 0.35,
  /** Sanción por inexactitud (Art 648 ET): 100% del impuesto omitido */
  sancionInexactitud: 1.0,
  /** Tasa de interés moratorio anual estimado (~tasa usura − 2 pp) */
  interesMoratoriosAnual: 0.24,
  /**
   * Probabilidad estimada de auditoría en 24 meses, dado que hay brecha
   * relevante. Conservador: con factura electrónica y cruces de información,
   * la DIAN detecta brechas estructurales. Ajustable por nivel.
   */
  probAuditoria24m: {
    low: 0.05,
    mid: 0.25,
    high: 0.5,
  },
  /**
   * Umbral aproximado para responsabilidad penal (250 SMLMV / año 2026).
   * SMLMV 2026 ≈ $1.423.500 ⇒ 250 × 12 ≈ $4.270M de impuesto omitido / año.
   * Simplificación educativa: usamos 250 SMLMV anual sobre impuesto omitido.
   */
  umbralPenalAnualCOP: 4_270_000_000,
} as const;

export type EvasionRiskLevel = 'low' | 'mid' | 'high';

export interface PenaltiesInput {
  /** Monto sin facturar del periodo medido (de evasionGap.gap) */
  gap: number;
  /** Nivel de riesgo (de evasionGap.level). Afecta la probabilidad de auditoría. */
  level: EvasionRiskLevel;
  /** Meses del periodo sobre el que se midió el gap. Default: 12. */
  periodMonths?: number;
  /** Horizonte de la simulación, en meses. Default: 24. */
  horizonMonths?: number;
  /** Tasa IVA. Default: DIAN_RATES.iva */
  ivaRate?: number;
  /** Tasa renta. Default: DIAN_RATES.renta */
  rentaRate?: number;
  /** Override de probabilidad de auditoría (0..1). Si no, usa DIAN_RATES por nivel. */
  probAuditoriaOverride?: number;
}

export interface PenaltiesResult {
  /** Gap proyectado al horizonte (ritmo constante) */
  gapProyectado: number;
  /** IVA omitido proyectado */
  ivaOmitido: number;
  /** Renta omitida proyectada (sobre utilidad estimada = gap, simplificado) */
  rentaOmitida: number;
  /** Impuesto total omitido = iva + renta */
  impuestoOmitido: number;
  /** Sanción por inexactitud = impuesto omitido × tasa sanción */
  sancion: number;
  /** Intereses moratorios estimados sobre el horizonte */
  intereses: number;
  /** Costo total si te auditan = impuesto + sanción + intereses */
  costoAuditoria: number;
  /** Probabilidad usada */
  probAuditoria: number;
  /** Costo esperado = costoAuditoria × probabilidad */
  costoEsperado: number;
  /** "Ahorro" aparente de evadir = impuesto no pagado */
  ahorroEvadir: number;
  /** Valor esperado neto de evadir = ahorro − costo esperado.
   *  Negativo ⇒ formalizar sale más barato en valor esperado. */
  valorEsperadoEvadir: number;
  /** Si el impuesto omitido anualizado supera el umbral penal */
  riesgoPenal: boolean;
}

/**
 * Calcula el costo esperado de evadir vs el ahorro tributario aparente.
 * Función pura. No consulta Supabase.
 */
export function calculatePenalties(input: PenaltiesInput): PenaltiesResult {
  const gap = toSafeNumber(input.gap);
  const periodMonths = input.periodMonths && input.periodMonths > 0 ? input.periodMonths : 12;
  const horizonMonths = input.horizonMonths && input.horizonMonths > 0 ? input.horizonMonths : 24;
  const ivaRate = input.ivaRate ?? DIAN_RATES.iva;
  const rentaRate = input.rentaRate ?? DIAN_RATES.renta;
  const probAuditoria = clamp01(
    input.probAuditoriaOverride ?? DIAN_RATES.probAuditoria24m[input.level]
  );

  // Proyección lineal del gap al horizonte.
  const gapProyectado = gap * (horizonMonths / periodMonths);

  // Impuestos omitidos sobre el gap proyectado.
  const ivaOmitido = gapProyectado * ivaRate;
  const rentaOmitida = gapProyectado * rentaRate;
  const impuestoOmitido = ivaOmitido + rentaOmitida;

  // Sanción por inexactitud (Art 648 ET).
  const sancion = impuestoOmitido * DIAN_RATES.sancionInexactitud;

  // Intereses moratorios: aproximación lineal sobre la mitad del horizonte
  // (la deuda se acumula gradualmente en el horizonte, no todo el periodo).
  const horizonAnios = horizonMonths / 12;
  const intereses = impuestoOmitido * DIAN_RATES.interesMoratoriosAnual * (horizonAnios / 2);

  const costoAuditoria = impuestoOmitido + sancion + intereses;
  const costoEsperado = costoAuditoria * probAuditoria;

  const ahorroEvadir = impuestoOmitido;
  const valorEsperadoEvadir = ahorroEvadir - costoEsperado;

  // Riesgo penal: impuesto omitido anualizado supera el umbral.
  const impuestoAnualizado = impuestoOmitido * (12 / horizonMonths);
  const riesgoPenal = impuestoAnualizado >= DIAN_RATES.umbralPenalAnualCOP;

  return {
    gapProyectado,
    ivaOmitido,
    rentaOmitida,
    impuestoOmitido,
    sancion,
    intereses,
    costoAuditoria,
    probAuditoria,
    costoEsperado,
    ahorroEvadir,
    valorEsperadoEvadir,
    riesgoPenal,
  };
}

function toSafeNumber(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
