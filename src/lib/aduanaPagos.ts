/**
 * Reconoce qué pagos del banco a la DIAN son LIQUIDACIONES DE ADUANA de un
 * contenedor (arancel + IVA de importación) y no impuestos del negocio.
 *
 * Por qué (auditoría 2026-11-12): los cuatro pagos de aduana de 2026 quedaron
 * tratados distinto. Enero y abril se marcaron "Devolución / DIAN" y salieron
 * del PyG; julio y octubre quedaron como Impuestos. En un PyG de caja, donde
 * las ventas entran con IVA, el IVA pagado en aduana TIENE que contar como
 * salida: es el que compensa el IVA cobrado (por eso las declaraciones de IVA
 * salen casi en cero). Este módulo solo los IDENTIFICA para mostrarlos en su
 * propia línea; no cambia montos ni grupos.
 *
 * Dos fuentes de liquidaciones:
 *  - Costeo del contenedor (import_costs tipo arancel / iva_importacion).
 *  - Recibos DIAN cargados como "factura de compra" con IVA (contenedores
 *    anteriores al módulo de Importaciones).
 *
 * Emparejamiento:
 *  - Un recibo vinculado al movimiento (transactions.invoice_id) empareja
 *    directo. Si no, por monto (±0,5%) a ±10 días.
 *  - Un costeo empareja con UN pago de la ventana [fecha − 30 d, fecha + 45 d]
 *    por el total, o con VARIOS pagos del mismo día que sumen el total (el
 *    2026-2 se pagó en dos PSE el mismo día).
 *  - El costeo va primero: un recibo DIAN que duplica el costeo del mismo
 *    contenedor no vuelve a reclamar el pago (ver isCustomsDuplicate).
 *
 * Devuelve un objeto plano (nunca Map: puede terminar en datos de React Query).
 */

import { normalizeForMatch } from '@/lib/stringUtils';
import { isTaxAuthorityName } from '@/lib/taxEstimates';

export interface LiquidacionAduana {
  /** Clave estable (id del contenedor o del recibo). */
  id: string;
  /** Texto para mostrar: "Pedido 2026-1" o "Recibo DIAN 29 ene 2026". */
  etiqueta: string;
  fuente: 'costeo' | 'recibo';
  /** Fecha de referencia YYYY-MM-DD (entrada a aduana o fecha del recibo). */
  fecha: string;
  arancel: number;
  iva: number;
  /** Solo recibos: id de la factura de compra, para el vínculo directo. */
  invoiceId?: string;
}

export interface PagoBanco {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number | null;
  description?: string | null;
  /** Nombre del beneficiario asignado, si tiene. */
  beneficiario?: string | null;
  invoice_id?: string | null;
}

export interface PagoAduana {
  liquidacionId: string;
  etiqueta: string;
  fuente: 'costeo' | 'recibo';
  /** Parte del PAGO (no de la liquidación) que es arancel / IVA. */
  arancel: number;
  iva: number;
}

const DAY_MS = 86_400_000;
const VENTANA_ANTES_DIAS = 30;
const VENTANA_DESPUES_DIAS = 45;
const VENTANA_RECIBO_DIAS = 10;
const MAX_PAGOS_MISMO_DIA = 8;

const t = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).getTime();
const tolerancia = (total: number) => Math.max(1_000, Math.abs(total) * 0.005);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[(m || 1) - 1]} ${y}`;
}

/** ¿El movimiento es un egreso a la DIAN (o a otra autoridad de impuestos)? */
export function esPagoAImpuestos(p: PagoBanco): boolean {
  if (!(Number(p.amount) < 0)) return false;
  if (isTaxAuthorityName(p.beneficiario)) return true;
  return /\bdian\b/.test(normalizeForMatch(p.description ?? ''));
}

// ── Fuentes ────────────────────────────────────────────────────────────────

export interface CosteoAduanaRow {
  importId: string;
  refPedido: string | null;
  tipo: string; // 'arancel' | 'iva_importacion' (otros se ignoran)
  montoCop: number;
  /** Entrada a aduana / entrega / arribo (misma regla que taxEstimates). */
  fecha: string;
}

/** Fecha de entrada a aduana de un contenedor: estado "aduana", si no
 *  "entregado", si no el arribo real, si no la fecha de creación del costo.
 *  Misma regla que el IVA de importación en taxEstimates. */
export function fechaEntradaAduana(
  historial: Array<{ estado: string; fecha: string }> | null | undefined,
  fechaArriboReal: string | null | undefined,
  createdAt: string | null | undefined,
): string {
  const h = historial ?? [];
  return (h.find((x) => x.estado === 'aduana')?.fecha
    ?? h.find((x) => x.estado === 'entregado')?.fecha
    ?? fechaArriboReal
    ?? (createdAt ?? '')).slice(0, 10);
}

/** Agrupa las filas de costeo (arancel + IVA) por contenedor. */
export function liquidacionesDesdeCosteo(rows: CosteoAduanaRow[]): LiquidacionAduana[] {
  const por: Record<string, LiquidacionAduana> = {};
  for (const r of rows) {
    if (r.tipo !== 'arancel' && r.tipo !== 'iva_importacion') continue;
    const monto = Number(r.montoCop) || 0;
    if (!(monto > 0) || !r.fecha) continue;
    const liq = por[r.importId] ?? (por[r.importId] = {
      id: `imp:${r.importId}`,
      etiqueta: r.refPedido ? `Pedido ${r.refPedido}` : 'Contenedor',
      fuente: 'costeo',
      fecha: r.fecha.slice(0, 10),
      arancel: 0,
      iva: 0,
    });
    if (r.tipo === 'arancel') liq.arancel += monto;
    else liq.iva += monto;
  }
  return Object.values(por);
}

export interface ReciboDianRow {
  id: string;
  counterparty_name?: string | null;
  issue_date: string;
  total_amount: number | null;
  iva_amount: number | null;
  void_type?: string | null;
}

/** Recibos DIAN con IVA cargados como factura de compra = liquidación de
 *  aduana de un contenedor anterior al módulo. Arancel = total − IVA. */
export function liquidacionesDesdeRecibos(rows: ReciboDianRow[]): LiquidacionAduana[] {
  const out: LiquidacionAduana[] = [];
  for (const r of rows) {
    if (r.void_type === 'total') continue;
    if (!isTaxAuthorityName(r.counterparty_name)) continue;
    const iva = Number(r.iva_amount) || 0;
    const total = Number(r.total_amount) || 0;
    if (!(iva > 0) || !(total >= iva)) continue;
    out.push({
      id: `rec:${r.id}`,
      etiqueta: `Recibo DIAN ${fechaCorta(r.issue_date)}`,
      fuente: 'recibo',
      fecha: r.issue_date.slice(0, 10),
      arancel: total - iva,
      iva,
      invoiceId: r.id,
    });
  }
  return out;
}

// ── Emparejamiento ─────────────────────────────────────────────────────────

/** Subconjunto de `pagos` (mismo día) que suma `total` dentro de tolerancia. */
function subconjuntoQueSuma(pagos: PagoBanco[], total: number): PagoBanco[] | null {
  const n = Math.min(pagos.length, MAX_PAGOS_MISMO_DIA);
  const tol = tolerancia(total);
  let mejor: PagoBanco[] | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let suma = 0;
    const sel: PagoBanco[] = [];
    for (let k = 0; k < n; k++) {
      if (mask & (1 << k)) { suma += Math.abs(Number(pagos[k].amount) || 0); sel.push(pagos[k]); }
    }
    if (Math.abs(suma - total) <= tol && (!mejor || sel.length < mejor.length)) mejor = sel;
  }
  return mejor;
}

function repartir(
  out: Record<string, PagoAduana>,
  pagos: PagoBanco[],
  liq: LiquidacionAduana,
) {
  const total = liq.arancel + liq.iva;
  const fraccionArancel = total > 0 ? liq.arancel / total : 0;
  for (const p of pagos) {
    const monto = Math.abs(Number(p.amount) || 0);
    const arancel = Math.round(monto * fraccionArancel);
    out[p.id] = {
      liquidacionId: liq.id,
      etiqueta: liq.etiqueta,
      fuente: liq.fuente,
      arancel,
      iva: monto - arancel,
    };
  }
}

/**
 * Devuelve { [txId]: PagoAduana } con los pagos del banco que son
 * liquidaciones de aduana. Cada pago se usa una sola vez.
 */
export function detectarPagosAduana(
  pagos: PagoBanco[],
  liquidaciones: LiquidacionAduana[],
): Record<string, PagoAduana> {
  const out: Record<string, PagoAduana> = {};
  const candidatos = pagos.filter(esPagoAImpuestos);
  const libre = (p: PagoBanco) => !out[p.id];

  // 1) Costeos primero (atados al contenedor real), del más viejo al más nuevo.
  const costeos = liquidaciones
    .filter((l) => l.fuente === 'costeo')
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const liq of costeos) {
    const total = liq.arancel + liq.iva;
    if (!(total > 0)) continue;
    const ref = t(liq.fecha);
    const enVentana = candidatos.filter((p) => {
      if (!libre(p)) return false;
      const d = (t(p.date) - ref) / DAY_MS;
      return d >= -VENTANA_ANTES_DIAS && d <= VENTANA_DESPUES_DIAS;
    });

    // Un solo pago por el total: el más cercano en fecha.
    const unico = enVentana
      .filter((p) => Math.abs(Math.abs(Number(p.amount) || 0) - total) <= tolerancia(total))
      .sort((a, b) => Math.abs(t(a.date) - ref) - Math.abs(t(b.date) - ref))[0];
    if (unico) { repartir(out, [unico], liq); continue; }

    // Varios pagos del mismo día que suman el total.
    const porDia: Record<string, PagoBanco[]> = {};
    for (const p of enVentana) (porDia[p.date.slice(0, 10)] ??= []).push(p);
    const dias = Object.keys(porDia).sort((a, b) => Math.abs(t(a) - ref) - Math.abs(t(b) - ref));
    for (const dia of dias) {
      const sel = subconjuntoQueSuma(porDia[dia], total);
      if (sel) { repartir(out, sel, liq); break; }
    }
  }

  // 2) Recibos DIAN: vínculo directo y, si no, por monto y fecha.
  for (const liq of liquidaciones.filter((l) => l.fuente === 'recibo')) {
    const total = liq.arancel + liq.iva;
    const vinculado = candidatos.find((p) => libre(p) && liq.invoiceId && p.invoice_id === liq.invoiceId);
    if (vinculado) { repartir(out, [vinculado], liq); continue; }
    const ref = t(liq.fecha);
    const porMonto = candidatos
      .filter((p) => libre(p)
        && Math.abs((t(p.date) - ref) / DAY_MS) <= VENTANA_RECIBO_DIAS
        && Math.abs(Math.abs(Number(p.amount) || 0) - total) <= tolerancia(total))
      .sort((a, b) => Math.abs(t(a.date) - ref) - Math.abs(t(b.date) - ref))[0];
    if (porMonto) repartir(out, [porMonto], liq);
  }

  return out;
}
