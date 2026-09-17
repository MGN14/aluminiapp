/**
 * Estimación del MONTO de las obligaciones tributarias del calendario (IVA,
 * retefuente, ICA) con las facturas y costos que ya tiene la app.
 *
 * Pedido de Nico 2026-09-16: "el calendario me dice pago de IVA pero aparece
 * —; la app podría calcular cuánto tengo que pagar y ponérmelo en el
 * recordatorio". Son ESTIMADOS (badge ≈): la declaración la cierra el
 * contador. Renta no se estima (depende de todo el año y de ajustes).
 *
 * Reglas:
 *  - IVA por período (bimestre o cuatrimestre): generado (ventas) −
 *    descontable (compras + IVA de importación pagado en aduana). Un saldo a
 *    favor de períodos anteriores del año se arrastra; un período positivo
 *    se asume pagado.
 *  - Retefuente del mes: autorretención sobre ventas (la que traen las
 *    facturas, o base × tasa si no viene) + retención practicada en compras
 *    (base × tasa configurada) + retenciones registradas "sin factura".
 *  - ICA del bimestre: ingresos (base ventas) × tarifa de la ciudad −
 *    reteICA que ya te practicaron los clientes.
 */

export interface InvoiceLite {
  type: 'venta' | 'compra';
  /** Informativo. OJO: los recibos DIAN - PSE cargados como "compra" son
   *  liquidaciones de ADUANA (IVA de importación + arancel) de contenedores
   *  anteriores al módulo de Importaciones: su IVA SÍ es descontable. No
   *  excluirlos (error 2026-09-17: dejaba el IVA May-Ago en 88M cuando el
   *  saldo a favor de Ene-Abr lo cubre entero). */
  counterparty_name?: string | null;
  issue_date: string; // YYYY-MM-DD
  subtotal_base: number;
  iva_amount: number;
  reteica_amount: number;
  autoretefuente_amount: number;
}

export interface TaxRates {
  /** Tarifa ICA de la ciudad como fracción (9,66‰ = 0.00966). */
  icaRate: number;
  /** Autorretención en la fuente como fracción (0,55% = 0.0055). */
  autoretefuenteRate: number;
  /** Retención practicada en compras como fracción (2,5% = 0.025). */
  retefuenteCompraRate: number;
  autorretenedor: boolean;
  agenteRetencion: boolean;
}

export interface TaxInputs {
  year: number;
  ivaCuatrimestral: boolean;
  invoices: InvoiceLite[];
  /** IVA de importación pagado en aduana, por fecha de entrada. */
  importIva: Array<{ fecha: string; montoCop: number }>;
  /** Retefuente registrada en egresos sin factura ([Retefuente - Sin factura]). */
  retefuenteManual: Array<{ date: string; amount: number }>;
  rates: TaxRates;
  /** Para tests: "hoy" (YYYY-MM-DD). */
  today?: string;
}

export interface TaxEstimate {
  monto: number;
  /** Desglose corto para el tooltip / línea secundaria. */
  detalle: string;
  /** El período aún no termina: el número crece hasta el cierre. */
  parcial: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const monthOf = (iso: string) => Number(iso.slice(5, 7));
const yearOf = (iso: string) => Number(iso.slice(0, 4));
const inPeriod = (iso: string, year: number, months: number[]) =>
  yearOf(iso) === year && months.includes(monthOf(iso));

/** Meses (1-12) de cada período del año para un tamaño dado. */
export function periodMonths(size: 1 | 2 | 4, index: number): number[] {
  const start = index * size + 1;
  return Array.from({ length: size }, (_, k) => start + k).filter((m) => m <= 12);
}

function periodEnded(year: number, months: number[], today: string): boolean {
  const last = months[months.length - 1];
  const endIso = `${year}-${String(last).padStart(2, '0')}-${new Date(year, last, 0).getDate()}`;
  return today > endIso;
}
function periodStarted(year: number, months: number[], today: string): boolean {
  return today >= `${year}-${String(months[0]).padStart(2, '0')}-01`;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Neto de IVA de un período (sin arrastre). */
function ivaNetoPeriodo(inp: TaxInputs, months: number[]) {
  const ventas = inp.invoices.filter((i) => i.type === 'venta' && inPeriod(i.issue_date, inp.year, months));
  const compras = inp.invoices.filter((i) => i.type === 'compra' && inPeriod(i.issue_date, inp.year, months));
  const generado = ventas.reduce((s, i) => s + (Number(i.iva_amount) || 0), 0);
  const descFacturas = compras.reduce((s, i) => s + (Number(i.iva_amount) || 0), 0);
  const descImport = inp.importIva
    .filter((r) => inPeriod(r.fecha, inp.year, months))
    .reduce((s, r) => s + (Number(r.montoCop) || 0), 0);
  return { generado, descFacturas, descImport, neto: generado - descFacturas - descImport };
}

/** IVA a pagar del período `index` (0-based dentro del año). */
export function estimateIva(inp: TaxInputs, index: number): TaxEstimate | null {
  const size = inp.ivaCuatrimestral ? 4 : 2;
  const months = periodMonths(size, index);
  if (months.length === 0) return null;
  const today = inp.today ?? todayIso();
  if (!periodStarted(inp.year, months, today)) return null;

  // Arrastre: un período anterior con saldo a favor se imputa al siguiente;
  // uno positivo se asume declarado y pagado.
  let arrastre = 0;
  for (let k = 0; k < index; k++) {
    const prev = ivaNetoPeriodo(inp, periodMonths(size, k));
    arrastre = Math.min(0, arrastre + prev.neto);
  }
  const cur = ivaNetoPeriodo(inp, months);
  if (cur.generado === 0 && cur.descFacturas === 0 && cur.descImport === 0 && arrastre === 0) return null;

  const monto = Math.max(0, cur.neto + arrastre);
  const partes = [`IVA generado ${fmt(cur.generado)}`];
  const descontable = cur.descFacturas + cur.descImport;
  if (descontable > 0) {
    partes.push(`− descontable ${fmt(descontable)}${cur.descImport > 0 ? ` (importación ${fmt(cur.descImport)})` : ''}`);
  }
  if (arrastre < 0) partes.push(`− saldo a favor ${fmt(-arrastre)}`);
  if (cur.neto + arrastre < 0) partes.push(`→ queda saldo a favor ${fmt(-(cur.neto + arrastre))}`);
  return { monto, detalle: partes.join(' '), parcial: !periodEnded(inp.year, months, today) };
}

/** Retefuente a pagar del mes `monthIndex` (0-based). */
export function estimateRetefuente(inp: TaxInputs, monthIndex: number): TaxEstimate | null {
  const months = periodMonths(1, monthIndex);
  const today = inp.today ?? todayIso();
  if (!periodStarted(inp.year, months, today)) return null;
  const ventas = inp.invoices.filter((i) => i.type === 'venta' && inPeriod(i.issue_date, inp.year, months));
  const compras = inp.invoices.filter((i) => i.type === 'compra' && inPeriod(i.issue_date, inp.year, months));

  let autorret = 0;
  if (inp.rates.autorretenedor) {
    autorret = ventas.reduce((s, i) => s + (Number(i.autoretefuente_amount) || 0), 0);
    if (autorret === 0 && inp.rates.autoretefuenteRate > 0) {
      autorret = ventas.reduce((s, i) => s + (Number(i.subtotal_base) || 0), 0) * inp.rates.autoretefuenteRate;
    }
  }
  const retCompras = inp.rates.agenteRetencion && inp.rates.retefuenteCompraRate > 0
    ? compras.reduce((s, i) => s + (Number(i.subtotal_base) || 0), 0) * inp.rates.retefuenteCompraRate
    : 0;
  const manual = inp.retefuenteManual
    .filter((t) => inPeriod(t.date, inp.year, months))
    .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);

  const monto = Math.round(autorret + retCompras + manual);
  if (monto <= 0) return null;
  const partes: string[] = [];
  if (autorret > 0) partes.push(`autorretención ${fmt(autorret)}`);
  if (retCompras > 0) partes.push(`retención en compras ${fmt(retCompras)}`);
  if (manual > 0) partes.push(`sin factura ${fmt(manual)}`);
  return { monto, detalle: partes.join(' + '), parcial: !periodEnded(inp.year, months, today) };
}

/** ICA a pagar del bimestre `index` (0-based). */
export function estimateIca(inp: TaxInputs, index: number): TaxEstimate | null {
  if (!(inp.rates.icaRate > 0)) return null;
  const months = periodMonths(2, index);
  const today = inp.today ?? todayIso();
  if (!periodStarted(inp.year, months, today)) return null;
  const ventas = inp.invoices.filter((i) => i.type === 'venta' && inPeriod(i.issue_date, inp.year, months));
  const base = ventas.reduce((s, i) => s + (Number(i.subtotal_base) || 0), 0);
  if (base <= 0) return null;
  const ica = base * inp.rates.icaRate;
  const reteica = ventas.reduce((s, i) => s + (Number(i.reteica_amount) || 0), 0);
  const monto = Math.round(Math.max(0, ica - reteica));
  const porMil = (inp.rates.icaRate * 1000).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const partes = [`ingresos ${fmt(base)} × ${porMil}‰ = ${fmt(ica)}`];
  if (reteica > 0) partes.push(`− reteICA practicada ${fmt(reteica)}`);
  return { monto, detalle: partes.join(' '), parcial: !periodEnded(inp.year, months, today) };
}

/** Estimación para un evento del calendario por su id (`iva-2`, `ret-8`, `ica-3`). */
export function estimateForEventId(inp: TaxInputs, id: string): TaxEstimate | null {
  const m = id.match(/^(iva|ret|ica)-(\d+)$/);
  if (!m) return null;
  const idx = Number(m[2]);
  if (m[1] === 'iva') return estimateIva(inp, idx);
  if (m[1] === 'ret') return estimateRetefuente(inp, idx);
  return estimateIca(inp, idx);
}
