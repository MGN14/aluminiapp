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
  // `impuestos` is a legacy field key retained for DB compatibility (score_impuestos column).
  // It now holds the "Control de Inventario" score: mide el descuadre entre Siigo y físico en costo.
  impuestos: {
    pct: number;
    ratioDescuadre: number;
    totalDifferenceValue: number;
    totalValueSiigo: number;
    productsWithDiff: number;
    totalProducts: number;
  };
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

export interface HealthInventoryProduct {
  stock_system: number | null;
  stock_physical: number | null;
  cost_per_unit: number | null;
  active?: boolean | null;
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
  retefuente_cliente_amount?: number | null;
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

// Linear score: pct * 20, rounded to 1 decimal
function linearScore(pct: number): number {
  return Math.round(clampPct(pct) * 20 * 10) / 10;
}

// Cartera risk: inverted linear (lower risk = higher score)
function carteraLinearScore(riesgo: number): number {
  return Math.round(clampPct(1 - riesgo) * 20 * 10) / 10;
}

export function getScoreInterpretation(score: number): { level: string; message: string; color: string } {
  if (score >= 90) return {
    level: '¡Felicitaciones! 🎉',
    message: 'Eres más ordenado y preparado que el 70% de las empresas colombianas. Tu negocio está listo para cualquier visita de la DIAN sin preocupaciones. Si tienes alguna duda, pregúntale a Nico.',
    color: 'text-success',
  };
  if (score >= 80) return {
    level: 'Casi listo, pero cuidado ⚠️',
    message: 'Estás cerca de tener todo en orden, pero aún hay detalles que podrían costarte una sanción de la DIAN. No vale la pena pagar una multa por falta de un poco de organización. Pregúntale a Nico cómo cerrar esas brechas.',
    color: 'text-success',
  };
  if (score >= 50) return {
    level: 'Hay problemas, pero puedes mejorar',
    message: 'Tu negocio tiene desorden financiero en varios frentes. Si la DIAN toca tu puerta hoy, tendrías dificultades para soportar varias operaciones. La buena noticia: aún estás a tiempo de corregirlo. Pregúntale a Nico por dónde empezar.',
    color: 'text-warning',
  };
  return {
    level: '🚨 Alerta máxima',
    message: 'Si la DIAN te visita mañana, no podrías soportar la mayoría de tus movimientos financieros. Esto puede significar sanciones graves, multas e incluso investigaciones. Es urgente actuar YA. Pregúntale a Nico qué hacer primero.',
    color: 'text-destructive',
  };
}

export function getRecommendations(scores: ScoreBreakdown): string[] {
  const recs: string[] = [];
  if (scores.conciliacion < 18) recs.push('Existen movimientos bancarios sin soporte. Revisa y vincula facturas, asigna responsables o clasifícalos correctamente.');
  if (scores.facturacion < 18) recs.push('Hay ingresos sin factura asociada ni marcados como anticipo. Esto puede generar inconsistencias frente a la DIAN.');
  if (scores.impuestos < 16) recs.push('Hay descuadre entre inventario Siigo y conteo físico. Revisa faltantes para descartar ventas sin factura, pérdidas o errores de registro.');
  if (scores.cartera < 18) recs.push('Una parte importante de tu facturación no ha sido cobrada o tienes anticipos sin factura asociada.');
  if (scores.clasificacion < 18) recs.push('Varias transacciones no tienen categoría, responsable o factura asignada. Completa la información para mejorar tu orden.');
  return recs;
}

export function calculateFinancialHealthMetrics(
  transactions: HealthTransaction[],
  confirmedInvoices: HealthInvoice[],
  salesInvoices: HealthInvoice[],
  matchedByInvoice: Map<string, number>,
  initialState?: { cuentas_por_cobrar?: number; anticipos_de_clientes?: number } | null,
  unlinkedAnticiposClientes?: number,
  currentPeriodAnticipos?: number,
  inventoryProducts?: HealthInventoryProduct[] | null
): { scores: ScoreBreakdown; details: ScoreDetails } {
  const initialAnticiposClientes = initialState?.anticipos_de_clientes ?? 0;
  const totalTx = transactions.length;

  // ========== 1. CONCILIACIÓN BANCARIA (amount-based) ==========
  const totalMovimientos = transactions.reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0);
  const montoPendiente = transactions
    .filter((tx) => !tx.responsible_id && !tx.invoice_id && !isNA(tx.notes) && !isAnticipo(tx.notes))
    .reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0);
  const pctConciliado = totalMovimientos > 0 ? clampPct(1 - montoPendiente / totalMovimientos) : 0;
  const scoreConciliacion = totalMovimientos > 0 ? linearScore(pctConciliado) : 0;

  // ========== 2. FACTURACIÓN SOPORTADA ==========
  // Use actual confirmed sales invoice totals vs total income + initial advances
  const ingresosTx = transactions.filter((tx) => (tx.amount ?? 0) > 0);
  const totalIngresosMonto = ingresosTx.reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const facturacionVentas = salesInvoices.reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0);
  const baseFacturacion = totalIngresosMonto + initialAnticiposClientes;
  const soportado = facturacionVentas;
  const saldoPorFacturar = Math.max(0, baseFacturacion - soportado);
  const pctSinFacturar = safePct(saldoPorFacturar, baseFacturacion);
  const pctSoportado = clampPct(1 - pctSinFacturar);
  const scoreFacturacion = baseFacturacion > 0 ? linearScore(pctSoportado) : 0;

  // ========== 3. CONTROL DE INVENTARIO (antes "Control de Impuestos") ==========
  // Mide el descuadre entre Siigo y físico en costo: señal DIAN genuina de ventas sin factura,
  // pérdidas, robos o errores de registro. Ratio = Σ|diff|·costo / Σ(Siigo·costo).
  // Menor descuadre => mejor score. Guardado en score_impuestos/impuestos por compat DB.
  const activeInventory = (inventoryProducts ?? []).filter((p) => p.active !== false);
  const totalValueSiigo = activeInventory.reduce((sum, p) => sum + (p.stock_system ?? 0) * (p.cost_per_unit ?? 0), 0);
  const totalDifferenceValue = activeInventory.reduce((sum, p) => {
    if (p.stock_physical === null || p.stock_physical === undefined) return sum;
    const diff = Math.abs((p.stock_system ?? 0) - p.stock_physical);
    return sum + diff * (p.cost_per_unit ?? 0);
  }, 0);
  const productsWithDiff = activeInventory.filter((p) =>
    p.stock_physical !== null && p.stock_physical !== undefined && (p.stock_system ?? 0) !== p.stock_physical
  ).length;
  const ratioDescuadre = totalValueSiigo > 0 ? clampPct(totalDifferenceValue / totalValueSiigo) : 0;
  const pctInventario = 1 - ratioDescuadre;
  const hasInventoryData = activeInventory.length > 0 && totalValueSiigo > 0;
  const scoreImpuestos = hasInventoryData ? linearScore(pctInventario) : 0;

  // ========== 4. CARTERA Y ANTICIPOS ==========
  const initialCxC = initialState?.cuentas_por_cobrar ?? 0;
  // initialAnticiposClientes already declared above

  const facturacionTotal = salesInvoices.reduce((sum, invoice) => sum + (invoice.total_amount ?? 0), 0);
  const cuentasPorCobrarFacturas = salesInvoices.reduce((sum, invoice) => {
    const paid = matchedByInvoice.get(invoice.id) ?? 0;
    const retefuente = invoice.retefuente_cliente_amount ?? 0;
    return sum + Math.max(0, (invoice.total_amount ?? 0) - paid - retefuente);
  }, 0);
  const cuentasPorCobrar = cuentasPorCobrarFacturas + initialCxC;
  const baseCartera = facturacionTotal + initialCxC;
  const pctCartera = safePct(cuentasPorCobrar, baseCartera);

  // Use pre-calculated total anticipos if provided (already includes unlinked initial),
  // otherwise fall back to [Anticipo] tag + unlinked initial
  const fallbackAnticipos = ingresosTx
    .filter((tx) => !tx.invoice_id && isAnticipo(tx.notes))
    .reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
  const effectiveUnlinkedAnticipos = unlinkedAnticiposClientes ?? initialAnticiposClientes;
  const totalAnticipos = currentPeriodAnticipos != null
    ? currentPeriodAnticipos
    : fallbackAnticipos + effectiveUnlinkedAnticipos;
  const baseAnticipos = totalIngresosMonto + initialAnticiposClientes;
  const pctAnticipos = safePct(totalAnticipos, baseAnticipos);

  const hasAnyCarteraData = baseCartera > 0 || baseAnticipos > 0;
  const riesgoTotal = hasAnyCarteraData ? (pctCartera + pctAnticipos) / 2 : 0;
  const scoreCartera = hasAnyCarteraData ? carteraLinearScore(riesgoTotal) : 0;

  // ========== 5. CLASIFICACIÓN FINANCIERA ==========
  // A transaction is "complete" if it has category + responsible + invoice support.
  // For expenses/transfers with a responsible assigned, having an invoice is not mandatory
  // (the responsible assignment already means it was reviewed and reconciled).
  const completas = transactions.filter((tx) => {
    const hasCategory = Boolean(tx.category_id);
    const hasResponsible = Boolean(tx.responsible_id) || isNA(tx.notes);
    const hasInvoice = Boolean(tx.invoice_id) || isNA(tx.notes) || isAnticipo(tx.notes);
    // If it has a responsible, the invoice requirement is relaxed (reconciled)
    const invoiceOk = hasInvoice || hasResponsible;
    return hasCategory && hasResponsible && invoiceOk;
  }).length;

  const pctClasificado = safePct(completas, totalTx);
  const scoreClasificacion = totalTx > 0 ? linearScore(pctClasificado) : 0;

  const total = Math.round((scoreConciliacion + scoreFacturacion + scoreImpuestos + scoreCartera + scoreClasificacion) * 10) / 10;

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
      ingresosConFactura: facturacionVentas,
      ingresosAnticipo: initialAnticiposClientes,
      totalIngresos: baseFacturacion,
    },
    impuestos: {
      pct: pctInventario,
      ratioDescuadre,
      totalDifferenceValue,
      totalValueSiigo,
      productsWithDiff,
      totalProducts: activeInventory.length,
    },
    cartera: {
      pct: riesgoTotal,
      pctCartera,
      pctAnticipos,
      cuentasPorCobrar,
      anticiposSinFactura: totalAnticipos,
      facturacionTotal: baseCartera,
      ingresosTotal: baseAnticipos,
    },
    clasificacion: { pct: pctClasificado, completas, total: totalTx },
  };

  return { scores, details };
}
