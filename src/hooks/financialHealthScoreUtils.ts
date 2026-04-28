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
  // `clasificacion` es el key legacy (mantenido por compatibilidad con DB).
  // Hoy representa "Pulmón financiero" — cuántos meses puede operar el negocio
  // con la plata disponible al ritmo actual de gastos. Reemplazó al viejo
  // factor de "Clasificación Financiera" que era redundante con Conciliación.
  clasificacion: {
    pct: number;
    saldoActual: number;
    gastoNetoMensual: number;
    runwayMeses: number | null; // null = no aplica (no estás quemando plata)
  };
}

export interface HealthInventoryProduct {
  stock_system: number | null;
  stock_physical: number | null;
  cost_per_unit: number | null;
  active?: boolean | null;
}

// Shared UI metadata for the 5 score variables — fuente única para todas las páginas
// (FinancialHealth, VisitaDIAN, dashboards). Si cambian nombres o colores, solo acá.
// Nota: el campo `key: 'impuestos'` se mantiene por compatibilidad con la DB y el tipo
// ScoreBreakdown; hoy representa "Control de Inventario" (descuadre Siigo vs físico en costo).
export type ScoreVariableKey = 'conciliacion' | 'facturacion' | 'impuestos' | 'cartera' | 'clasificacion';

export interface ScoreVariableMeta {
  key: ScoreVariableKey;
  label: string;
  shortLabel: string;
  color: string;
  hint: string;
}

export const SCORE_VARIABLES: readonly ScoreVariableMeta[] = [
  {
    key: 'conciliacion',
    label: 'Conciliación Bancaria',
    shortLabel: 'Conciliación',
    color: 'hsl(217, 91%, 60%)',
    hint: 'Qué % de tus movimientos bancarios está soportado con factura, responsable asignado o marcado como N/A.',
  },
  {
    key: 'facturacion',
    label: 'Facturación Soportada',
    shortLabel: 'Facturación',
    color: 'hsl(152, 69%, 40%)',
    hint: 'Qué % de tus ingresos reales está respaldado por facturas DIAN emitidas.',
  },
  {
    key: 'impuestos',
    label: 'Control de Inventario',
    shortLabel: 'Inventario',
    color: 'hsl(24, 95%, 53%)',
    hint: 'Qué tan cuadrado está tu inventario Siigo contra el físico, medido en costo. Descuadre alto = posible fuga, venta sin factura o error de registro.',
  },
  {
    key: 'cartera',
    label: 'Cartera y Anticipos',
    shortLabel: 'Cartera',
    color: 'hsl(280, 84%, 60%)',
    hint: 'Qué % de tu facturación está pendiente de cobro o en anticipos sin factura asociada.',
  },
  {
    key: 'clasificacion',
    label: 'Pulmón financiero',
    shortLabel: 'Pulmón',
    color: 'hsl(173, 58%, 39%)',
    hint: 'Cuántos meses puede operar tu negocio con la plata disponible al ritmo actual de gastos.',
  },
] as const;

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
  if (scores.clasificacion < 18) recs.push('Tu pulmón financiero está justo: la plata disponible alcanza para pocos meses al ritmo de gastos actual. Revisá si hay egresos recortables o aceleración de cobros.');
  return recs;
}

export function calculateFinancialHealthMetrics(
  transactions: HealthTransaction[],
  confirmedInvoices: HealthInvoice[],
  salesInvoices: HealthInvoice[],
  matchedByInvoice: Map<string, number>,
  initialState?: {
    cuentas_por_cobrar?: number;
    anticipos_de_clientes?: number;
    saldo_bancos?: number;
  } | null,
  unlinkedAnticiposClientes?: number,
  currentPeriodAnticipos?: number,
  inventoryProducts?: HealthInventoryProduct[] | null,
  // Para Pulmón financiero (Cash Runway): el burn neto mensual promedio
  // calculado afuera (por el caller que conoce los últimos 3 meses cerrados).
  // Si > 0: estás quemando plata (egresos > ingresos). Si ≤ 0: generando.
  gastoNetoMensual?: number,
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

  // ========== 5. PULMÓN FINANCIERO (legacy key: clasificacion) ==========
  // Cuántos meses puede operar el negocio con la plata disponible al ritmo
  // actual de gastos. Métrica clásica de CFO (Cash Runway).
  //
  //   saldoActual = saldo_bancos inicial + Σ(ingresos hasta hoy) − Σ(egresos hasta hoy)
  //   gastoNetoMensual = promedio (egresos − ingresos) últimos 3 meses cerrados
  //   runway = saldoActual / gastoNetoMensual   (en meses)
  //
  // Score:
  //   - Si gastoNetoMensual ≤ 0 → estás generando plata, no quemando: 20pts
  //   - 12+ meses de runway → 20pts (zona verde, holgura)
  //   - 0 meses → 0pts
  //   - Lineal entre 0 y 12 meses
  const saldoInicial = initialState?.saldo_bancos ?? 0;
  const sumaIngresos = transactions
    .filter(t => (t.amount ?? 0) > 0)
    .reduce((s, t) => s + (t.amount ?? 0), 0);
  const sumaEgresos = transactions
    .filter(t => (t.amount ?? 0) < 0)
    .reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  const saldoActual = saldoInicial + sumaIngresos - sumaEgresos;

  const gastoNeto = gastoNetoMensual ?? 0;
  let scoreClasificacion = 0;
  let runwayMeses: number | null = null;
  let pctClasificado = 0;

  if (gastoNeto <= 0) {
    // Generando plata, runway "infinito" → score máximo
    scoreClasificacion = 20;
    runwayMeses = null;
    pctClasificado = 1;
  } else if (saldoActual <= 0) {
    // En rojo, sin plata
    scoreClasificacion = 0;
    runwayMeses = 0;
    pctClasificado = 0;
  } else {
    runwayMeses = saldoActual / gastoNeto;
    // Lineal: 12+ meses = 20, 0 meses = 0
    pctClasificado = clampPct(runwayMeses / 12);
    scoreClasificacion = linearScore(pctClasificado);
  }

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
    clasificacion: {
      pct: pctClasificado,
      saldoActual,
      gastoNetoMensual: gastoNeto,
      runwayMeses,
    },
  };

  return { scores, details };
}
