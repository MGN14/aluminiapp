/**
 * Fase 2 del inventario por VARIANTE de color: movimientos automáticos.
 *
 *   ENTRADA — packing list nacionalizado: cuando un pedido de Importaciones
 *   pasa a 'entregado', sus import_items (packing manda sobre proforma) suman
 *   stock por variante con su costo (costo_unitario_excel como vara v1).
 *   SALIDA — remisiones: la referencia de remision_items ya viene con el
 *   sufijo de color tal como se despachó → descuenta la variante exacta.
 *
 * TODO es best-effort y NO-OP mientras la maestra esté vacía o la referencia
 * no exista como variante (decisión de Nico: la maestra que él sube MANDA —
 * acá no se auto-crean variantes). El inventario -5 (inventory_products)
 * sigue su flujo propio; este ledger es independiente.
 *
 * Idempotencia: índice único (variant_id, source_type, source_id) + chequeo
 * previo por source — reintentar no duplica el contenedor ni la remisión.
 */

import { supabase } from '@/integrations/supabase/client';
import { applyColorSuffix } from '@/lib/refFamily';
import { normalizeVariantRef } from '@/hooks/useInventoryVariants';

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
  const unique = Array.from(new Set(refs.map(normalizeVariantRef).filter(Boolean)));
  if (!unique.length) return new Map();
  const { data, error } = await db
    .from('inventory_variants')
    .select('id, variant_reference, stock, avg_cost')
    .in('variant_reference', unique)
    .eq('active', true);
  if (error) throw error;
  const map = new Map<string, VariantLite>();
  for (const v of (data ?? []) as VariantLite[]) map.set(normalizeVariantRef(v.variant_reference), v);
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
  /** Referencias sin variante en la maestra (se saltaron, no se auto-crean). */
  unmatched: string[];
}

const NOOP: VariantApplyResult = { applied: 0, unmatched: [] };

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
    const v = variants.get(normalizeVariantRef(it.reference));
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
export async function applyVariantImportEntrada(importId: string): Promise<VariantApplyResult> {
  const { data: itemsData, error: itErr } = await db
    .from('import_items')
    .select('reference, cantidad, color, source, costo_unitario_excel')
    .eq('import_id', importId);
  if (itErr) throw itErr;
  const all = (itemsData ?? []) as { reference: string; cantidad: number; color: string | null; source: string | null; costo_unitario_excel: number | null }[];
  if (!all.length) return NOOP;

  // Packing definitivo manda; proforma solo si no hay packing.
  const hayPacking = all.some((r) => (r.source ?? 'packing') === 'packing');
  const items = hayPacking ? all.filter((r) => (r.source ?? 'packing') === 'packing') : all;

  const refsConSufijo = items.map((it) => applyColorSuffix(it.reference, it.color ?? null));
  const variants = await fetchVariantsByRefs(refsConSufijo);
  if (!variants.size) return NOOP;
  if (await sourceAlreadyApplied('import', importId)) return NOOP;

  // Agregar por variante (mismo color puede venir en varios renglones).
  const acc = new Map<string, { qty: number; costo: number }>(); // costo = Σ qty×unit
  const unmatched: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const v = variants.get(normalizeVariantRef(refsConSufijo[i]));
    if (!v) { unmatched.push(refsConSufijo[i]); continue; }
    const qty = Math.abs(Number(items[i].cantidad ?? 0));
    if (qty <= 0) continue;
    const unit = Number(items[i].costo_unitario_excel ?? 0);
    const a = acc.get(v.id) ?? { qty: 0, costo: 0 };
    a.qty += qty; a.costo += qty * unit;
    acc.set(v.id, a);
  }
  if (!acc.size) return { applied: 0, unmatched };

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
      const nuevoAvg = (base * Number(v.avg_cost ?? 0) + a.costo) / (base + a.qty);
      const { error: upErr } = await db
        .from('inventory_variants')
        .update({ stock: base + a.qty, avg_cost: Math.round(nuevoAvg) })
        .eq('id', variantId);
      if (upErr) throw upErr;
    } else {
      await applyVariantDelta(variantId, a.qty, Number(v.stock ?? 0));
    }
  }
  return { applied: acc.size, unmatched };
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
