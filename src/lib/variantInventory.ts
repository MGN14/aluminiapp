/**
 * Fase 2 del inventario por VARIANTE de color: movimientos automáticos.
 *
 *   ENTRADA — packing list nacionalizado: cuando un pedido de Importaciones
 *   pasa a 'entregado', sus import_items (packing manda sobre proforma) suman
 *   stock por variante con su costo (costo_unitario_excel como vara v1).
 *   SALIDA — remisiones: la referencia de remision_items ya viene con el
 *   sufijo de color tal como se despachó → descuenta la variante exacta.
 *
 * Puertas de entrada de referencias NUEVAS (decisión de Nico, 2026-07-29):
 *   · IMPORTACIONES: el packing del contenedor CREA las variantes que no
 *     existan (es lo primero que entra al sistema con referencias).
 *   · La maestra sigue mandando para ANCLAR conteos.
 *   · Las REMISIONES nunca crean (un typo no fabrica inventario): sin match
 *     → no-op + aviso.
 * El inventario -5 (inventory_products) sigue su flujo propio (Siigo).
 *
 * Idempotencia: índice único (variant_id, source_type, source_id) + chequeo
 * previo por source — reintentar no duplica el contenedor ni la remisión.
 */

import { supabase } from '@/integrations/supabase/client';
import { applyColorSuffix, canonicalizeRef } from '@/lib/refFamily';


const db = supabase as never as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

interface VariantLite {
  id: string;
  variant_reference: string;
  stock: number;
  avg_cost: number;
}

/** Variantes activas indexadas por referencia normalizada. Map vacío = maestra
 *  sin sembrar → todos los hooks quedan en no-op. */
async function fetchVariantsByRefs(refs: string[]): Promise<Map<string, VariantLite>> {
  const buscadas = new Set(refs.map((r) => canonicalizeRef(r)).filter(Boolean));
  if (!buscadas.size) return new Map();
  // Se traen TODAS las variantes activas y se cruzan por forma canónica: el
  // `.in()` exacto fallaba cuando la misma pieza venía escrita distinto
  // ("38*38-3" de China vs "38X38-3" de la maestra) y el contenedor no
  // entraba al stock. La maestra son ~cientos de filas: traerlas es barato.
  const { data, error } = await db
    .from('inventory_variants')
    .select('id, variant_reference, stock, avg_cost')
    .eq('active', true);
  if (error) throw error;
  const map = new Map<string, VariantLite>();
  for (const v of (data ?? []) as VariantLite[]) {
    const key = canonicalizeRef(v.variant_reference);
    if (buscadas.has(key)) map.set(key, v);
  }
  return map;
}

async function applyVariantDelta(variantId: string, delta: number, fallbackCurrent: number): Promise<void> {
  if (delta === 0) return;
  const { error } = await db.rpc('apply_variant_stock_delta', { p_variant_id: variantId, p_delta: delta });
  if (!error) return;
  // RPC aún no desplegado (migración sin aplicar) → read-modify-write.
  const missingFn = /function|schema cache|not.*found|404/i.test(String((error as any).message || (error as any).code || ''));
  if (!missingFn) throw error;
  const { error: upErr } = await db
    .from('inventory_variants')
    .update({ stock: fallbackCurrent + delta })
    .eq('id', variantId);
  if (upErr) throw upErr;
}

/** ¿Esta fuente ya se aplicó al ledger? (idempotencia por source). */
async function sourceAlreadyApplied(sourceType: string, sourceId: string): Promise<boolean> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface VariantApplyResult {
  applied: number;
  /** Referencias sin variante en la maestra (remisiones: se saltan — un typo
   *  no crea inventario. Importaciones: se CREAN, ver applyVariantImportEntrada). */
  unmatched: string[];
  /** Variantes NUEVAS creadas desde el packing del contenedor. */
  created?: number;
}

const NOOP: VariantApplyResult = { applied: 0, unmatched: [], created: 0 };

// ── SALIDA / ENTRADA por remisión ───────────────────────────────────────────

export interface VariantRemisionItem {
  reference: string; // tal como se despachó (con sufijo de color)
  units: number;
}

/**
 * Aplica una remisión al inventario por variante. venta = salida; compra =
 * entrada. Best-effort: si la maestra está vacía o ninguna ref matchea, no-op.
 */
export async function applyVariantRemision(params: {
  remisionId: string;
  remisionType: 'venta' | 'compra';
  movementDate: string;
  items: VariantRemisionItem[];
}): Promise<VariantApplyResult> {
  const { remisionId, remisionType, movementDate, items } = params;
  const variants = await fetchVariantsByRefs(items.map((i) => i.reference));
  if (!variants.size) return NOOP;
  if (await sourceAlreadyApplied('remision', remisionId)) return NOOP;

  const sign = remisionType === 'compra' ? 1 : -1;
  const movementType = remisionType === 'compra' ? 'entrada' : 'salida';

  // Agregar por variante: el índice único exige UNA fila por (variante, fuente).
  const qtyPorVariante = new Map<string, number>();
  const unmatched: string[] = [];
  for (const it of items) {
    const v = variants.get(canonicalizeRef(it.reference));
    if (!v) { unmatched.push(it.reference); continue; }
    qtyPorVariante.set(v.id, (qtyPorVariante.get(v.id) ?? 0) + Math.abs(Number(it.units ?? 0)));
  }
  if (!qtyPorVariante.size) return { applied: 0, unmatched };

  const porId = new Map([...variants.values()].map((v) => [v.id, v]));
  const rows = [...qtyPorVariante.entries()].map(([variantId, qty]) => ({
    variant_id: variantId,
    movement_type: movementType,
    quantity: qty,
    unit_cost: 0,
    source_type: 'remision',
    source_id: remisionId,
    fecha: movementDate,
  }));
  const { error } = await db.from('inventory_variant_movements').insert(rows);
  if (error) throw error;

  for (const [variantId, qty] of qtyPorVariante) {
    await applyVariantDelta(variantId, sign * qty, porId.get(variantId)?.stock ?? 0);
  }
  return { applied: qtyPorVariante.size, unmatched };
}

/** Revierte los movimientos por variante de una remisión (borrado/edición). */
export async function reverseVariantRemision(remisionId: string): Promise<void> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id, variant_id, movement_type, quantity')
    .eq('source_type', 'remision')
    .eq('source_id', remisionId);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; variant_id: string; movement_type: string; quantity: number }[];
  if (!rows.length) return;

  for (const m of rows) {
    const sign = m.movement_type === 'entrada' ? -1 : 1; // revertir el signo original
    await applyVariantDelta(m.variant_id, sign * Number(m.quantity), 0);
  }
  await db.from('inventory_variant_movements').delete().in('id', rows.map((r) => r.id));
}

// ── ENTRADA por packing nacionalizado (import → entregado) ─────────────────

/**
 * Suma el packing list de un pedido entregado al inventario por variante,
 * con su costo (costo_unitario_excel v1 — la vara de Nico) y recalcula el
 * costo promedio ponderado. Packing manda sobre proforma. Idempotente.
 */
export async function applyVariantImportEntrada(
  importId: string,
  opts?: { reapply?: boolean },
): Promise<VariantApplyResult> {
  // Re-aplicar (excel nuevo): la reversa SOLO se hace si la nueva entrada va
  // a matchear algo. Antes se reversaba primero y, si las referencias del
  // excel no existían en la maestra, la re-entrada quedaba en no-op y el
  // stock se PERDÍA (bug detectado 2026-07-24).
  if (opts?.reapply) {
    // Con el auto-create (2026-07-29) el reapply es seguro mientras el pedido
    // tenga items: la re-entrada matchea o CREA — nunca deja el stock perdido.
    const { data: peek } = await db
      .from('import_items')
      .select('id')
      .eq('import_id', importId)
      .limit(1);
    if (!((peek ?? []) as unknown[]).length) return NOOP;
    await reverseVariantImportEntrada(importId);
  }
  return applyVariantImportEntradaInner(importId);
}

async function applyVariantImportEntradaInner(importId: string): Promise<VariantApplyResult> {
  const { data: itemsData, error: itErr } = await db
    .from('import_items')
    .select('reference, descripcion, cantidad, color, source, costo_unitario_excel')
    .eq('import_id', importId);
  if (itErr) throw itErr;
  const all = (itemsData ?? []) as { reference: string; descripcion: string | null; cantidad: number; color: string | null; source: string | null; costo_unitario_excel: number | null }[];
  if (!all.length) return NOOP;

  // Packing definitivo manda; proforma solo si no hay packing.
  const hayPacking = all.some((r) => (r.source ?? 'packing') === 'packing');
  const items = hayPacking ? all.filter((r) => (r.source ?? 'packing') === 'packing') : all;

  const refsConSufijo = items.map((it) => applyColorSuffix(it.reference, it.color ?? null));
  let variants = await fetchVariantsByRefs(refsConSufijo);
  if (await sourceAlreadyApplied('import', importId)) return NOOP;

  // Referencias del contenedor SIN variante: se CREAN (decisión de Nico,
  // 2026-07-29 — "el módulo de importaciones es la puerta de entrada de
  // referencias nuevas"). Antes se saltaban en silencio y la app no conocía
  // mercancía que estaba físicamente en bodega (las 43 refs de Lina). La
  // maestra sigue mandando para ANCLAR conteos; ya no es la única puerta.
  let created = 0;
  const nuevasPorCanonical = new Map<string, { variant_reference: string; name: string | null }>();
  for (let i = 0; i < items.length; i++) {
    const key = canonicalizeRef(refsConSufijo[i]);
    if (!key || variants.has(key) || nuevasPorCanonical.has(key)) continue;
    if (Math.abs(Number(items[i].cantidad ?? 0)) <= 0) continue;
    nuevasPorCanonical.set(key, {
      variant_reference: refsConSufijo[i].trim().toUpperCase(),
      name: (items[i].descripcion ?? '').trim() || null,
    });
  }
  if (nuevasPorCanonical.size) {
    const nowIso = new Date().toISOString();
    const rows = [...nuevasPorCanonical.values()].map((n) => ({
      variant_reference: n.variant_reference,
      name: n.name,
      stock: 0,           // la entrada del contenedor pone stock y costo abajo
      avg_cost: 0,
      stock_inicial: 0,
      stock_inicial_date: nowIso,
      active: true,
    }));
    // Upsert por si dos corridas concurrentes crean la misma (trigger pone user_id).
    const { error: crErr } = await db
      .from('inventory_variants')
      .upsert(rows, { onConflict: 'user_id,variant_reference' });
    if (crErr) throw crErr;
    created = rows.length;
    variants = await fetchVariantsByRefs(refsConSufijo); // re-cruce con las nuevas
  }
  if (!variants.size) return NOOP;

  // Agregar por variante (mismo color puede venir en varios renglones).
  const acc = new Map<string, { qty: number; costo: number }>(); // costo = Σ qty×unit
  const unmatched: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const v = variants.get(canonicalizeRef(refsConSufijo[i]));
    if (!v) { unmatched.push(refsConSufijo[i]); continue; }
    const qty = Math.abs(Number(items[i].cantidad ?? 0));
    if (qty <= 0) continue;
    const unit = Number(items[i].costo_unitario_excel ?? 0);
    const a = acc.get(v.id) ?? { qty: 0, costo: 0 };
    a.qty += qty; a.costo += qty * unit;
    acc.set(v.id, a);
  }
  if (!acc.size) return { applied: 0, unmatched, created };

  const porId = new Map([...variants.values()].map((v) => [v.id, v]));
  const rows = [...acc.entries()].map(([variantId, a]) => ({
    variant_id: variantId,
    movement_type: 'entrada',
    quantity: a.qty,
    unit_cost: a.qty > 0 ? a.costo / a.qty : 0,
    source_type: 'import',
    source_id: importId,
    nota: 'Packing list nacionalizado',
  }));
  const { error } = await db.from('inventory_variant_movements').insert(rows);
  if (error) throw error;

  for (const [variantId, a] of acc) {
    const v = porId.get(variantId)!;
    const unit = a.qty > 0 ? a.costo / a.qty : 0;
    // Costo promedio ponderado: solo si la entrada trae costo (>0).
    if (unit > 0) {
      const base = Math.max(0, Number(v.stock ?? 0));
      // Mismo guard que el kardex: si el stock previo no tiene costo (ancla
      // de conteo sin columna de costo → avg 0), el costo de la entrada
      // MANDA — promediar contra $0 diluía el costo del excel (87 und a $0
      // + 40 a $25.000 daba $7.874/und, reporte de Nico 2026-07-30).
      const avgPrevio = Number(v.avg_cost ?? 0);
      const nuevoAvg = (base <= 0 || avgPrevio <= 0)
        ? unit
        : (base * avgPrevio + a.costo) / (base + a.qty);
      const { error: upErr } = await db
        .from('inventory_variants')
        .update({ stock: base + a.qty, avg_cost: Math.round(nuevoAvg) })
        .eq('id', variantId);
      if (upErr) throw upErr;
    } else {
      await applyVariantDelta(variantId, a.qty, Number(v.stock ?? 0));
    }
  }
  return { applied: acc.size, unmatched, created };
}

/**
 * Borra los movimientos de import ANTERIORES a un re-anclaje de conteo, SIN
 * tocar el stock: su efecto ya fue pisado por el ancla (el conteo definió el
 * stock), pero las filas seguían ahí y la idempotencia por fuente decía "ya
 * aplicado" — el contenedor nunca re-entraba (reporte de Nico 2026-07-30).
 * Después de purgar, applyVariantImportEntrada aplica limpio.
 */
export async function purgeStaleImportMovements(importId: string, cutoffIso: string): Promise<number> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id, created_at')
    .eq('source_type', 'import')
    .eq('source_id', importId)
    .lte('created_at', cutoffIso);
  if (error) throw error;
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return 0;
  const { error: delErr } = await db.from('inventory_variant_movements').delete().in('id', ids);
  if (delErr) throw delErr;
  return ids.length;
}

/** Revierte la entrada de un pedido (estado corregido de 'entregado' a otro). */
export async function reverseVariantImportEntrada(importId: string): Promise<void> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id, variant_id, quantity')
    .eq('source_type', 'import')
    .eq('source_id', importId);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; variant_id: string; quantity: number }[];
  if (!rows.length) return;
  for (const m of rows) {
    await applyVariantDelta(m.variant_id, -Number(m.quantity), 0);
  }
  await db.from('inventory_variant_movements').delete().in('id', rows.map((r) => r.id));
}
