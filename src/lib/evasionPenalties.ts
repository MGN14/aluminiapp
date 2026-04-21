/**
 * evasionPenalties — Estima cuánto te costaría la DIAN si te auditan por la
 * brecha medida en evasionGap.ts.
 *
 * Distinción clave entre auditable y no auditable:
 *   - La DIAN cruza facturas electrónicas contra movimientos bancarios, contra
 *     consignaciones y contra declaraciones de terceros. Por eso puede
 *     "probar" y tasar: bank + anticipos previos − invoiced.
 *   - El EFECTIVO no tiene cruce directo. La DIAN no puede tasarlo por cruces
 *     estándar. PERO tiene enemigos: consignación en cuenta propia/familiar,
 *     denuncias, UIAF (>$10M), cruces patrimoniales vs estilo de vida, visitas
 *     físicas, etc. Ver sección CASH_RISKS más abajo.
 *
 *   Por eso separamos:
 *     auditableGap = max(0, gap − cashPortion)
 *     cashGap      = min(gap, cashPortion)
 *
 *   Sanción y intereses se tasan SOLO sobre la parte auditable (caso típico).
 *   Ahorro tributario aparente se computa sobre el gap total (es lo que el
 *   contribuyente realmente dejó de pagar).
 *
 * Fuentes normativas (Colombia, vigentes 2026):
 *   - Art 648 ET: Sanción por inexactitud = 100% del mayor valor del impuesto
 *     a cargo determinado oficialmente por la DIAN.
 *   - Art 635 ET: Intereses moratorios a tasa usura menos dos puntos (~24% EA).
 *   - Art 434A CP: Fraude fiscal > 250 SMLMV/año ⇒ 48–108 meses prisión.
 *   - UIAF Res 14 de 2020: operaciones en efectivo individuales ≥ $10.000.000
 *     deben reportarse; patrones sospechosos activan investigación.
 *
 * Estas tasas son aproximaciones educativas. Objetivo: mostrar que el
 * "ahorro" de evadir rara vez compensa el riesgo real.
 */

/** Tasas y umbrales DIAN. Editables si el producto cambia de criterio. */
export const DIAN_RATES = {
  /** IVA general Colombia (2026) */
  iva: 0.19,
  /** Renta persona jurídica (2026) */
  renta: 0.35,
  /** Sanción por inexactitud (Art 648 ET): 100% del impuesto omitido */
  sancionInexactitud: 1.0,
  /** Interés moratorio anual estimado (~tasa usura − 2 pp) */
  interesMoratoriosAnual: 0.24,
  /**
   * Probabilidad estimada de auditoría formal en 24 meses cuando hay brecha
   * bancaria sostenida. Con factura electrónica + cruces, la DIAN detecta
   * brechas estructurales. Ajustable por nivel.
   */
  probAuditoria24m: {
    low: 0.05,
    mid: 0.25,
    high: 0.5,
  },
  /**
   * Umbral aproximado para responsabilidad penal (Art 434A CP):
   * 250 SMLMV/año. SMLMV 2026 estimado ≈ $1.423.500 ⇒ umbral ≈ $4.270M de
   * impuesto omitido anual. Simplificación educativa.
   */
  umbralPenalAnualCOP: 4_270_000_000,
  /** Umbral UIAF para operación sospechosa en efectivo (Res 14/2020) */
  uiafReporteCOP: 10_000_000,
} as const;

/**
 * Lista declarativa de "enemigos del efectivo": rutas por las que plata en
 * efectivo termina siendo descubierta aunque no haya cruce bancario directo.
 * La UI la muestra como tabla educativa.
 */
export const CASH_RISKS = [
  {
    title: 'Consignación en cuenta propia o familiar',
    detail:
      'En cuanto depositás el efectivo en tu cuenta, tu cuenta de tu esposa, hijo o socio, entra al cruce. El origen no justificado suma a la auditoría.',
  },
  {
    title: 'Denuncia de terceros',
    detail:
      'Ex-socios, empleados despedidos, competidores o ex-parejas. La DIAN acepta denuncias anónimas y las prioriza si vienen con documentación.',
  },
  {
    title: 'Cruce patrimonial (Art 236 ET)',
    detail:
      'Si tu patrimonio declarado no crece proporcional a tu estilo de vida (carros, viajes, inmuebles), la DIAN asume incremento patrimonial no justificado.',
  },
  {
    title: 'Reporte UIAF ≥ $10M',
    detail:
      'Bancos y notarías reportan operaciones en efectivo ≥ $10M. Patrones repetidos activan investigación automática.',
  },
  {
    title: 'Robo, pérdida o incendio',
    detail:
      'Sin factura ni registro, plata perdida es plata perdida. No podés reclamarla al seguro ni denunciarla.',
  },
  {
    title: 'Cliente corporativo exige factura',
    detail:
      'Empresas medianas y grandes solo compran con factura (para poder deducir). El efectivo te deja fuera de los contratos grandes.',
  },
  {
    title: 'No accedés a crédito formal',
    detail:
      'El banco pide estados financieros reales. Si tu negocio declara la mitad, te prestan sobre la mitad.',
  },
] as const;

export type EvasionRiskLevel = 'low' | 'mid' | 'high';

export interface PenaltiesInput {
  /** Monto sin facturar del periodo (de evasionGap.gap) */
  gap: number;
  /**
   * Porción del gap que entró en efectivo (de evasionGap.cash).
   * Default: 0 (todo auditable).
   * La DIAN no puede cruzar efectivo directamente, pero ver CASH_RISKS.
   */
  cashPortion?: number;
  /** Nivel de riesgo (de evasionGap.level). Afecta probabilidad auditoría. */
  level: EvasionRiskLevel;
  /** Meses del periodo sobre el que se midió el gap. Default: 12. */
  periodMonths?: number;
  /** Horizonte de la simulación, en meses. Default: 24. */
  horizonMonths?: number;
  /** Tasa IVA. Default: DIAN_RATES.iva */
  ivaRate?: number;
  /** Tasa renta. Default: DIAN_RATES.renta */
  rentaRate?: number;
  /** Override de probabilidad (0..1). Si no, usa DIAN_RATES por nivel. */
  probAuditoriaOverride?: number;
}

export interface PenaltiesResult {
  // ── Proyecciones ──────────────────────────────────────────
  /** Gap proyectado al horizonte (ritmo constante) */
  gapProyectado: number;
  /** Porción proyectada en efectivo (no auditable por cruces) */
  cashProyectado: number;
  /** Porción proyectada en banco + anticipos (auditable) */
  auditableProyectado: number;

  // ── Ahorro tributario sobre el gap TOTAL (lo que no pagó) ──
  /** IVA omitido sobre gap total */
  ivaOmitidoTotal: number;
  /** Renta omitida sobre gap total */
  rentaOmitidaTotal: number;
  /** Impuesto total omitido = IVA + renta sobre gap total */
  impuestoOmitidoTotal: number;

  // ── Costo de auditoría: SOLO sobre la parte auditable ──────
  /** Impuesto auditable = (iva + renta) × auditableProyectado */
  impuestoAuditable: number;
  /** Sanción por inexactitud sobre lo auditable (Art 648 ET) */
  sancion: number;
  /** Intereses moratorios sobre lo auditable */
  intereses: number;
  /** Costo total si te auditan = impuestoAuditable + sancion + intereses */
  costoAuditoria: number;

  // ── Probabilidades y valor esperado ────────────────────────
  probAuditoria: number;
  /** Costo esperado = costoAuditoria × probAuditoria */
  costoEsperado: number;
  /** "Ahorro" aparente de evadir = impuesto omitido total */
  ahorroEvadir: number;
  /** Balance neto esperado = ahorro − costo esperado.
   *  Positivo ⇒ evadir parece ganar (típicamente porque el cash es grande).
   *  Ver también riesgos indirectos en CASH_RISKS. */
  valorEsperadoEvadir: number;

  // ── Banderas ───────────────────────────────────────────────
  /** Umbral Art 434A CP. Usa el total (cash + auditable) porque con evidencia
   *  la DIAN puede extender el tasado a efectivo. */
  riesgoPenal: boolean;
  /** Impuesto omitido anualizado (para mostrar contra umbral penal) */
  impuestoAnualizado: number;
  /** Flag: hay efectivo relevante (≥1 operación UIAF) */
  cashSobreUIAF: boolean;
}

/**
 * Calcula el costo esperado de evadir vs el ahorro tributario aparente.
 * Función pura. No consulta Supabase.
 */
export function calculatePenalties(input: PenaltiesInput): PenaltiesResult {
  const gap = toSafeNumber(input.gap);
  const cashPortion = Math.min(gap, toSafeNumber(input.cashPortion ?? 0));
  const periodMonths = positiveOr(input.periodMonths, 12);
  const horizonMonths = positiveOr(input.horizonMonths, 24);
  const ivaRate = input.ivaRate ?? DIAN_RATES.iva;
  const rentaRate = input.rentaRate ?? DIAN_RATES.renta;
  const probAuditoria = clamp01(
    input.probAuditoriaOverride ?? DIAN_RATES.probAuditoria24m[input.level],
  );
  const taxRate = ivaRate + rentaRate;

  // Proyección lineal al horizonte.
  const scale = horizonMonths / periodMonths;
  const gapProyectado = gap * scale;
  const cashProyectado = cashPortion * scale;
  const auditableProyectado = Math.max(0, gapProyectado - cashProyectado);

  // Ahorro tributario sobre el gap TOTAL (es lo que el contribuyente dejó
  // de pagar, independiente de si es visible o no al DIAN).
  const ivaOmitidoTotal = gapProyectado * ivaRate;
  const rentaOmitidaTotal = gapProyectado * rentaRate;
  const impuestoOmitidoTotal = ivaOmitidoTotal + rentaOmitidaTotal;

  // Costo de auditoría: sólo sobre la parte que la DIAN puede tasar por
  // cruces estándar (bank + anticipos − invoiced).
  const impuestoAuditable = auditableProyectado * taxRate;
  const sancion = impuestoAuditable * DIAN_RATES.sancionInexactitud;
  const horizonAnios = horizonMonths / 12;
  const intereses = impuestoAuditable * DIAN_RATES.interesMoratoriosAnual * (horizonAnios / 2);
  const costoAuditoria = impuestoAuditable + sancion + intereses;
  const costoEsperado = costoAuditoria * probAuditoria;

  const ahorroEvadir = impuestoOmitidoTotal;
  const valorEsperadoEvadir = ahorroEvadir - costoEsperado;

  // Riesgo penal: usamos el TOTAL porque el umbral es por impuesto omitido, y
  // con evidencia la DIAN sí puede extenderse a cash. Es la peor cara.
  const impuestoAnualizado = impuestoOmitidoTotal * (12 / horizonMonths);
  const riesgoPenal = impuestoAnualizado >= DIAN_RATES.umbralPenalAnualCOP;

  const cashSobreUIAF = cashPortion >= DIAN_RATES.uiafReporteCOP;

  return {
    gapProyectado,
    cashProyectado,
    auditableProyectado,
    ivaOmitidoTotal,
    rentaOmitidaTotal,
    impuestoOmitidoTotal,
    impuestoAuditable,
    sancion,
    intereses,
    costoAuditoria,
    probAuditoria,
    costoEsperado,
    ahorroEvadir,
    valorEsperadoEvadir,
    riesgoPenal,
    impuestoAnualizado,
    cashSobreUIAF,
  };
}

function toSafeNumber(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

function positiveOr(n: number | undefined, fallback: number): number {
  return n && n > 0 ? n : fallback;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
