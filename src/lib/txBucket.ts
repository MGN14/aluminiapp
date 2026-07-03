/**
 * Clasificación de movimientos bancarios en buckets de conciliación.
 *
 * Modelo (doc conciliacion-bancaria-propuesta.md): el módulo pedía factura a
 * TODO y por eso se sentía vacío — solo los cobros de venta pueden tener
 * factura de cartera. Cada movimiento pertenece a 1 de 4 buckets que define
 * qué se espera de él:
 *
 *   cobro_venta  → ingreso operativo (Ventas o sin categorizar): único bucket
 *                  que muestra el selector de factura.
 *   pago_gasto   → egreso operativo (o ingreso no-venta: préstamo/aporte/
 *                  devolución): categorizar; factura de compra/crédito opcional.
 *   traspaso     → movement_nature = traspaso: matchear pierna espejo,
 *                  excluido del P&L. Sin selector de factura.
 *   banco        → generado por el banco (4x1000, intereses, cuota de manejo,
 *                  comisiones, IVA sobre comisiones): auto-categorizable por
 *                  reglas, N/A silencioso. Sin selector de factura.
 */

import { normalizeForMatch } from '@/lib/stringUtils';

export type TxBucket = 'cobro_venta' | 'pago_gasto' | 'traspaso' | 'banco';

export interface BucketTx {
  amount: number | null;
  description: string | null;
  category_id?: string | null;
  invoice_id?: string | null;
  responsible_id?: string | null;
  movement_nature?: string | null;
  notes?: string | null;
  date?: string;
  id?: string;
  statement_id?: string | null;
}

/** Conceptos que genera el banco solo — nunca van a tener factura de cartera.
 *  Se evalúan sobre la descripción normalizada (lower, sin tildes, espacios
 *  colapsados — misma normalización que las reglas). */
const BANK_GENERATED_PATTERNS: RegExp[] = [
  /4x1000/,
  /impto gobierno/,
  /gravamen/,
  /abono intereses/,
  /intereses ahorros/,
  /cuota manejo/,
  /c manejo tarj/,
  /iva pagos automaticos/,
  /cobro iva/,
  /comision/,
  /\bcomis\b/,
  /servicio transferencia/,
  /cuota plan canal/,
  /iva cuota plan/,
  /comis swift/,
];

export function isBankGenerated(description: string | null | undefined): boolean {
  if (!description) return false;
  const norm = normalizeForMatch(description);
  return BANK_GENERATED_PATTERNS.some((re) => re.test(norm));
}

/**
 * Clasifica un movimiento. `categoryName` = nombre de la categoría asignada
 * (si tiene) — "Ventas" define el bucket cobro_venta junto al signo.
 */
export function classifyBucket(tx: BucketTx, categoryName?: string | null): TxBucket {
  if (tx.movement_nature === 'traspaso') return 'traspaso';
  if (isBankGenerated(tx.description)) return 'banco';

  const amount = Number(tx.amount ?? 0);
  if (amount > 0) {
    // Ingresos de naturaleza no operativa no son cobros de venta
    if (tx.movement_nature && tx.movement_nature !== 'operativo') return 'pago_gasto';
    const cat = categoryName ? normalizeForMatch(categoryName) : null;
    // Ventas explícita, o todavía sin categorizar (candidato a cobro de venta)
    if (!cat || cat.includes('venta')) return 'cobro_venta';
    return 'pago_gasto';
  }
  return 'pago_gasto';
}

/** ¿Este movimiento debería mostrar el selector de factura? */
export function bucketWantsInvoice(bucket: TxBucket, txType: string | null | undefined): boolean {
  if (bucket === 'traspaso' || bucket === 'banco') return false;
  // cobro_venta siempre; pago_gasto solo para egresos (facturas de compra /
  // cuotas de crédito se enlazan por ahí — opcional, no exigido).
  if (bucket === 'cobro_venta') return true;
  return txType === 'egreso';
}

// ── Traspasos: detección de pierna espejo ────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Un traspaso entre cuentas propias debe tener contraparte: mismo monto con
 * signo opuesto, a ±N días (default 5). Devuelve los traspasos SIN pierna
 * espejo — plata que salió "hacia una cuenta propia" y nunca apareció del
 * otro lado (o falta subir el extracto de la otra cuenta).
 */
export function findUnmatchedTraspasos<T extends BucketTx>(transactions: T[], toleranceDays = 5): T[] {
  const traspasos = transactions.filter((t) => t.movement_nature === 'traspaso');
  if (!traspasos.length) return [];

  const used = new Set<string>();
  const unmatched: T[] = [];

  const time = (t: BucketTx) => {
    const [y, m, d] = (t.date ?? '1970-01-01').split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };

  for (const t of traspasos) {
    const amount = Number(t.amount ?? 0);
    if (!amount) continue;
    const mirror = traspasos.find((m) =>
      m.id !== t.id &&
      !used.has(m.id ?? '') &&
      Math.abs(Number(m.amount ?? 0) + amount) < 1 && // signo opuesto, mismo valor (±$1)
      Math.abs(time(m) - time(t)) <= toleranceDays * DAY_MS
    );
    if (mirror) {
      used.add(t.id ?? '');
      used.add(mirror.id ?? '');
    } else if (!used.has(t.id ?? '')) {
      unmatched.push(t);
    }
  }
  return unmatched;
}

// ── KPIs de cierre (no de etiquetado) ────────────────────────────────────────

export interface CierreKpis {
  /** Cobros de venta (bucket cobro_venta con categoría ya asignada o factura) */
  cobrosVenta: number;
  /** Cobros de venta explicados: factura enlazada o N/A explícito */
  cobrosConciliados: number;
  cobrosPct: number;
  /** Líneas de banco sin explicar: sin categoría y sin factura */
  sinExplicar: number;
  /** Traspasos sin pierna espejo */
  traspasosSinContraparte: number;
}

export function computeCierreKpis<T extends BucketTx>(
  transactions: T[],
  categoryNameById: Map<string, string>,
): CierreKpis {
  let cobrosVenta = 0;
  let cobrosConciliados = 0;
  let sinExplicar = 0;

  for (const tx of transactions) {
    const catName = tx.category_id ? categoryNameById.get(tx.category_id) : null;
    const bucket = classifyBucket(tx, catName);

    if (bucket === 'cobro_venta') {
      cobrosVenta++;
      const naExplicito = (tx.notes ?? '').includes('[N/A - Sin factura]');
      if (tx.invoice_id || naExplicito) cobrosConciliados++;
      else if (!tx.category_id) sinExplicar++;
      continue;
    }
    // Traspasos se miden aparte (contraparte); banco/gasto sin categoría = sin explicar
    if (bucket !== 'traspaso' && !tx.category_id) sinExplicar++;
  }

  const traspasosSinContraparte = findUnmatchedTraspasos(transactions).length;

  return {
    cobrosVenta,
    cobrosConciliados,
    cobrosPct: cobrosVenta > 0 ? Math.round((cobrosConciliados / cobrosVenta) * 100) : 100,
    sinExplicar,
    traspasosSinContraparte,
  };
}
