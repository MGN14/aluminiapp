export interface ScoreBreakdown {
  conciliacion: number;
  facturacion: number;
  impuestos: number;
  cartera: number;
  clasificacion: number;
  total: number;
}

export interface ScoreDetails {
  conciliacion: { pct: number; montoPendiente: number; totalMovimientos: number };
  facturacion: { pct: number; ingresosConFactura: number; ingresosAnticipo: number; totalIngresos: number };
  impuestos: { pct: number; pctVentas: number; pctCompras: number; pctVinculados: number };
  cartera: {
    pct: number;
    pctCartera: number;
    pctAnticipos: number;
    cuentasPorCobrar: number;
    anticiposSinFactura: number;
    facturacionTotal: number;
    ingresosTotal: number;
  };
  clasificacion: { pct: number; completas: number; total: number };
}

export interface HistoricalScore {
  month: number;
  year: number;
  score_total: number;
  score_conciliacion: number;
  score_facturacion: number;
  score_impuestos: number;
  score_cartera: number;
  score_clasificacion: number;
}

export interface HealthTransaction {
  id: string;
  amount: number | null;
  responsible_id: string | null;
  invoice_id: string | null;
  notes: string | null;
  category_id: string | null;
}

export interface HealthInvoice {
  id: string;
  type: string | null;
  total_amount: number | null;
}

function isNA(notes: string | null): boolean {
  return Boolean(notes?.includes('[N/A]'));
}

function isAnticipo(notes: string | null): boolean {
  return Boolean(notes?.includes('[Anticipo]'));
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function safePct(part: number, total: number): number {
  if (total <= 0) return 0;
  return clampPct(part / total);
}

// 6-tier scale used for conciliacion, facturacion, clasificacion
function sixTierScore(pct: number): number {
  if (pct >= 0.98) return 20;
  if (pct >= 0.95) return 18;
  if (pct >= 0.9) return 15;
  if (pct >= 0.8) return 10;
  if (pct >= 0.7) return 5;
  return 0;
}

// 5-tier scale used for impuestos
function fiveTierScore(pct: number): number {
  if (pct >= 0.95) return 20;
  if (pct >= 0.85) return 16;
  if (pct >= 0.7) return 12;
  if (pct >= 0.5) return 6;
  return 0;
}

// Cartera risk scale (lower is better)
function carteraScore(riesgo: number): number {
  if (riesgo <= 0.05) return 20;
  if (riesgo <= 0.1) return 18;
  if (riesgo <= 0.2) return 15;
  if (riesgo <= 0.3) return 10;
  if (riesgo <= 0.4) return 5;
  return 0;
}

export function getScoreInterpretation(score: number): { level: string; message: string; color: string } {
  if (score >= 90) return {
    level: 'Muy ordenado',
    message: 'Tu negocio tiene un alto nivel de organización financiera. La información disponible permitiría enfrentar una revisión tributaria con tranquilidad.',
    color: 'text-success',
  };
  if (score >= 75) return {
    level: 'Orden saludable',
    message: 'Tus finanzas están relativamente organizadas, pero aún existen algunos puntos que podrían generar inconsistencias si la información fuera revisada.',
    color: 'text-success',
  };
  if (score >= 60) return {
    level: 'Orden aceptable con riesgos',
    message: 'Tu negocio muestra desorden financiero en algunos aspectos. Es recomendable organizar tu información antes de que esto genere problemas fiscales o de control.',
    color: 'text-warning',
  };
  if (score >= 45) return {
    level: 'Riesgo alto',
    message: 'Tu negocio tiene un nivel de desorden financiero considerable. Si hoy recibieras una revisión de la DIAN, probablemente tendrías dificultades para soportar varias operaciones.',
    color: 'text-destructive',
  };
  return {
    level: 'Riesgo crítico',
    message: 'Tu negocio presenta un nivel de desorden financiero muy alto. En el estado actual sería difícil soportar adecuadamente los movimientos financieros ante una revisión de la DIAN. Es urgente organizar la información.',
    color: 'text-destructive',
  };
}

export function getRecommendations(scores: ScoreBreakdown): string[] {
  const recs: string[] = [];
  if (scores.conciliacion < 18) recs.push('Existen movimientos bancarios sin soporte. Revisa y vincula facturas, asigna responsables o clasifícalos correctamente.');
  if (scores.facturacion < 18) recs.push('Hay ingresos sin factura asociada ni marcados como anticipo. Esto puede generar inconsistencias frente a la DIAN.');
  if (scores.impuestos < 16) recs.push('La base fiscal del periodo está incompleta. Faltan facturas de compra o venta que afectan el cálculo del IVA y retenciones.');
  if (scores.cartera < 18) recs.push('Una parte importante de tu facturación no ha sido cobrada o tienes anticipos sin factura asociada.');
  if (scores.clasificacion < 18) recs.push('Varias transacciones no tienen categoría, responsable o factura asignada. Completa la información para mejorar tu orden.');
  return recs;
}

export function calculateFinancialHealthMetrics(
  transactions: HealthTransaction[],
  confirmedInvoices: HealthInvoice[],
  salesInvoices: HealthInvoice[],
  matchedByInvoice: Map<string, number>
): { scores: ScoreBreakdown; details: ScoreDetails } {
  const totalTx = transactions.length;

  // ========== 1. CONCILIACIÓN BANCARIA (amount-based) ==========
  const totalMovimientos = transactions.reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0);
  const montoPendiente = transactions
    .filter((tx) => !tx.responsible_id && !tx.invoice_id && !isNA(tx.notes) && !isAnticipo(tx.notes))
    .reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0);
  const pctConciliado = totalMovimientos > 0 ? clampPct(1 - montoPendiente / totalMovimientos) : 0;
  const scoreConciliacion = totalMovimientos > 0 ? sixTierScore(pctConciliado) : 0;

  // ========== 2. FACTURACIÓN SOPORTADA ==========
  const ingresosTx = transactions.filter((tx) => (tx.amount ?? 0) > 0);
  const totalIngresosMonto = ingresosTx.reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const ingresosConFacturaMonto = ingresosTx
    .filter((tx) => Boolean(tx.invoice_id))
    .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const ingresosAnticipoMonto = ingresosTx
    .filter((tx) => !tx.invoice_id && isAnticipo(tx.notes))
    .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const pctSoportado = safePct(ingresosConFacturaMonto + ingresosAnticipoMonto, totalIngresosMonto);
  const scoreFacturacion = totalIngresosMonto > 0 ? sixTierScore(pctSoportado) : 0;

  // ========== 3. CONTROL DE IMPUESTOS ==========
  const egresosTx = transactions.filter((tx) => (tx.amount ?? 0) < 0);

  const ingresosConFacturaCount = ingresosTx.filter((tx) => Boolean(tx.invoice_id)).length;
  const egresosConFacturaCount = egresosTx.filter((tx) => Boolean(tx.invoice_id)).length;

  const relevantes = transactions.filter((tx) => (tx.amount ?? 0) !== 0);
  const vinculadosCount = relevantes.filter((tx) => Boolean(tx.invoice_id) || isNA(tx.notes)).length;

  const pctVentas = safePct(ingresosConFacturaCount, ingresosTx.length);
  const pctCompras = safePct(egresosConFacturaCount, egresosTx.length);
  const pctVinculados = safePct(vinculadosCount, relevantes.length);

  const hasAnyFiscalData = transactions.length > 0 || confirmedInvoices.length > 0;
  const completitudFiscal = hasAnyFiscalData ? (pctVentas + pctCompras + pctVinculados) / 3 : 0;
  const scoreImpuestos = hasAnyFiscalData ? fiveTierScore(completitudFiscal) : 0;

  // ========== 4. CARTERA Y ANTICIPOS ==========
  const facturacionTotal = salesInvoices.reduce((sum, invoice) => sum + (invoice.total_amount ?? 0), 0);
  const cuentasPorCobrar = salesInvoices.reduce((sum, invoice) => {
    const paid = matchedByInvoice.get(invoice.id) ?? 0;
    return sum + Math.max(0, (invoice.total_amount ?? 0) - paid);
  }, 0);
  const pctCartera = safePct(cuentasPorCobrar, facturacionTotal);

  const anticiposSinFactura = ingresosTx
    .filter((tx) => !tx.invoice_id && isAnticipo(tx.notes))
    .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const pctAnticipos = safePct(anticiposSinFactura, totalIngresosMonto);

  const hasAnyCarteraData = facturacionTotal > 0 || totalIngresosMonto > 0;
  const riesgoTotal = hasAnyCarteraData ? (pctCartera + pctAnticipos) / 2 : 0;
  const scoreCartera = hasAnyCarteraData ? carteraScore(riesgoTotal) : 0;

  // ========== 5. CLASIFICACIÓN FINANCIERA ==========
  const completas = transactions.filter((tx) => {
    const hasCategory = Boolean(tx.category_id);
    const hasResponsible = Boolean(tx.responsible_id) || isNA(tx.notes);
    const hasInvoice = Boolean(tx.invoice_id) || isNA(tx.notes) || isAnticipo(tx.notes);
    return hasCategory && hasResponsible && hasInvoice;
  }).length;

  const pctClasificado = safePct(completas, totalTx);
  const scoreClasificacion = totalTx > 0 ? sixTierScore(pctClasificado) : 0;

  const total = scoreConciliacion + scoreFacturacion + scoreImpuestos + scoreCartera + scoreClasificacion;

  const scores: ScoreBreakdown = {
    conciliacion: scoreConciliacion,
    facturacion: scoreFacturacion,
    impuestos: scoreImpuestos,
    cartera: scoreCartera,
    clasificacion: scoreClasificacion,
    total,
  };

  const details: ScoreDetails = {
    conciliacion: { pct: pctConciliado, montoPendiente, totalMovimientos },
    facturacion: {
      pct: pctSoportado,
      ingresosConFactura: ingresosConFacturaMonto,
      ingresosAnticipo: ingresosAnticipoMonto,
      totalIngresos: totalIngresosMonto,
    },
    impuestos: { pct: completitudFiscal, pctVentas, pctCompras, pctVinculados },
    cartera: {
      pct: riesgoTotal,
      pctCartera,
      pctAnticipos,
      cuentasPorCobrar,
      anticiposSinFactura,
      facturacionTotal,
      ingresosTotal: totalIngresosMonto,
    },
    clasificacion: { pct: pctClasificado, completas, total: totalTx },
  };

  return { scores, details };
}
