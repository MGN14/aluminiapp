/**
 * Entrada del contenedor al inventario -5 (inventory_products) vía kardex.
 *
 * Cierra el hueco #1 de la auditoría 2026-07-24: la entrada por variantes era
 * automática al entregar, pero inventory_products (la fuente del COGS en
 * Rentabilidad/PyG) dependía de un botón manual. Ahora la entrada al kardex
 * corre sola al marcar 'entregado' y al aplicar el excel de costeo.
 *
 * Reglas (decisiones de Nico):
 *   - COSTO: el costo unitario del EXCEL manda ("la realidad es el excel");
 *     el landed cost calculado por la app es fallback cuando falta.
 *   - PROMEDIO PONDERADO contra el stock remanente del contenedor anterior
 *     (lo hace el RPC kardex_movimiento — método estándar CO / Siigo).
 *   - FAMILIA -5: el packing viene por color (LIV-40-3) pero el inventario
 *     de Siigo maneja la familia (LIV-40-5) → se agrupa por refFamilyKey y
 *     se entra con la referencia real del producto en inventario.
 *
 * Idempotencia: se calcula el NETO (entradas − salidas) de los movimientos
 * con origen ('import', importId). Neto > 0 = ya aplicado → no-op salvo
 * reapply, que primero reversa con 'salida_ajuste' (auditable, atómico) y
 * vuelve a entrar con los números vigentes — así "el último excel manda".
 * Todo best-effort: sin packing o sin productos matcheados es no-op.
 */

import { supabase } from '@/integrations/supabase/client';
import { refFamilyKey } from '@/lib/refFamily';
import { computeLandedCost } from '@/lib/landedCost';

const db = supabase as never as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

export interface KardexApplyResult {
  /** Familias con entrada registrada en el kardex. */
  applied: number;
  /** Familias del packing sin producto en inventory_products. */
  missing: string[];
  /** Familias sin ningún costo (ni excel ni landed con TRM) — no entraron. */
  sinCosto: string[];
  /** true = ya estaba aplicado y no se pidió re-aplicar (no se tocó nada). */
  skipped: boolean;
}

const NOOP: KardexApplyResult = { applied: 0, missing: [], sinCosto: [], skipped: false };

interface ImportItemLite {
  id: string;
  reference: string;
  cantidad: number;
  unidad: string;
  peso_kg: number | null;
  fob_total_usd: number;
  source: string | null;
  costo_unitario_excel: number | null;
}

/** Neto por producto de los movimientos de kardex de este contenedor. */
async function fetchImportNet(importId: string): Promise<Map<string, number>> {
  const { data, error } = await db
    .from('inventory_movements')
    .select('product_id, movement_type, quantity')
    .eq('origen_tipo', 'import')
    .eq('origen_id', importId);
  if (error) throw error;
  const net = new Map<string, number>();
  for (const m of (data ?? []) as { product_id: string; movement_type: string; quantity: number }[]) {
    const sign = m.movement_type === 'entrada' ? 1 : -1;
    net.set(m.product_id, (net.get(m.product_id) ?? 0) + sign * Number(m.quantity ?? 0));
  }
  return net;
}

/**
 * Reversa la entrada de este contenedor con 'salida_ajuste' (mismo origen,
 * así el neto vuelve a 0 y la idempotencia sigue funcionando).
 */
export async function reverseImportKardex(importId: string): Promise<number> {
  const net = await fetchImportNet(importId);
  const pendientes = [...net.entries()].filter(([, qty]) => qty > 0.0001);
  if (!pendientes.length) return 0;

  const { data: prods, error } = await db
    .from('inventory_products')
    .select('id, reference')
    .in('id', pendientes.map(([id]) => id));
  if (error) throw error;
  const refById = new Map(((prods ?? []) as { id: string; reference: string }[]).map(p => [p.id, p.reference]));

  let reversed = 0;
  for (const [productId, qty] of pendientes) {
    const ref = refById.get(productId);
    if (!ref) continue;
    const { error: rpcErr } = await db.rpc('kardex_movimiento', {
      p_reference: ref,
      p_tipo: 'salida_ajuste',
      p_cantidad: qty,
      p_costo_unitario: null,
      p_origen_tipo: 'import',
      p_origen_id: importId,
      p_notas: 'Reversa entrada contenedor (re-costeo / estado corregido)',
    });
    if (!rpcErr) reversed += 1;
  }
  return reversed;
}

/**
 * Entra el contenedor al kardex de inventory_products, agrupado por familia.
 * Costo unitario por familia = promedio ponderado de (excel ?? landed) de sus
 * renglones. No-op si ya está aplicado (salvo opts.reapply).
 */
export async function applyImportKardex(
  importId: string,
  opts?: { reapply?: boolean },
): Promise<KardexApplyResult> {
  // 1. Packing manda sobre proforma (mismo criterio que variantes/costeo).
  const { data: itemsData, error: itErr } = await db
    .from('import_items')
    .select('id, reference, cantidad, unidad, peso_kg, fob_total_usd, source, costo_unitario_excel')
    .eq('import_id', importId);
  if (itErr) throw itErr;
  const all = (itemsData ?? []) as ImportItemLite[];
  if (!all.length) return NOOP;
  const hayPacking = all.some(r => (r.source ?? 'packing') === 'packing');
  const items = hayPacking ? all.filter(r => (r.source ?? 'packing') === 'packing') : all;
  if (!items.length) return NOOP;

  // 2. Idempotencia por neto de movimientos.
  const net = await fetchImportNet(importId);
  const yaAplicado = [...net.values()].some(v => v > 0.0001);
  if (yaAplicado && !opts?.reapply) return { ...NOOP, skipped: true };
  if (yaAplicado && opts?.reapply) await reverseImportKardex(importId);

  // 3. Landed como fallback de costo (necesita costos + TRM ponderada).
  const [{ data: costsData }, { data: liq }] = await Promise.all([
    db.from('import_costs').select('*').eq('import_id', importId).order('orden'),
    db.from('imports_liquidation').select('trm_promedio_ponderada').eq('import_id', importId).maybeSingle(),
  ]);
  const trm = Number((liq as { trm_promedio_ponderada?: number } | null)?.trm_promedio_ponderada ?? 0) || null;
  const landed = computeLandedCost(items as never, (costsData ?? []) as never, trm);
  const landedById = new Map(landed.items.map(r => [r.id, r.landed_unit_cop]));

  // 4. Agrupar por FAMILIA: qty total + costo ponderado (excel manda).
  const familias = new Map<string, { qty: number; costoBase: number; qtyConCosto: number; label: string }>();
  for (const it of items) {
    const fam = refFamilyKey(it.reference);
    if (!fam) continue;
    const qty = Math.abs(Number(it.cantidad ?? 0));
    if (qty <= 0) continue;
    const excel = Number(it.costo_unitario_excel ?? 0);
    const unit = excel > 0 ? excel : Number(landedById.get(it.id) ?? 0);
    const f = familias.get(fam) ?? { qty: 0, costoBase: 0, qtyConCosto: 0, label: it.reference };
    f.qty += qty;
    if (unit > 0) { f.costoBase += qty * unit; f.qtyConCosto += qty; }
    familias.set(fam, f);
  }
  if (!familias.size) return NOOP;

  // 5. Familia → referencia real del inventario -5 (RLS filtra por dueño).
  const { data: prods, error: prErr } = await db
    .from('inventory_products')
    .select('id, reference');
  if (prErr) throw prErr;
  const prodByFam = new Map<string, string>(); // familia → reference tal cual en inventario
  for (const p of (prods ?? []) as { id: string; reference: string }[]) {
    if (p.reference) prodByFam.set(refFamilyKey(p.reference), p.reference);
  }

  // 6. Entrada por familia vía RPC (atómico, promedio ponderado en el server).
  let applied = 0;
  const missing: string[] = [];
  const sinCosto: string[] = [];
  for (const [fam, f] of familias) {
    const ref = prodByFam.get(fam);
    if (!ref) { missing.push(f.label); continue; }
    if (f.qtyConCosto <= 0) { sinCosto.push(f.label); continue; }
    const unit = Math.round((f.costoBase / f.qtyConCosto) * 100) / 100;
    const { error } = await db.rpc('kardex_movimiento', {
      p_reference: ref,
      p_tipo: 'entrada_importacion',
      p_cantidad: f.qty,
      p_costo_unitario: unit,
      p_origen_tipo: 'import',
      p_origen_id: importId,
      p_notas: 'Entrada contenedor (excel de costeo / landed)',
    });
    if (!error) applied += 1;
    else missing.push(f.label);
  }
  return { applied, missing, sinCosto, skipped: false };
}
