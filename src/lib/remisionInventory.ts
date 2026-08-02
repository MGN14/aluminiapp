import { supabase } from '@/integrations/supabase/client';
import { applyVariantRemision, reverseVariantRemision } from '@/lib/variantInventory';
import { refFamilyKey } from '@/lib/refFamily';

export type RemisionType = 'venta' | 'compra';

export interface RemisionItemInput {
  reference: string;
  product_name: string;
  units: number;
  unit_cost: number;
}

export interface ProductLite {
  id: string;
  reference: string;
  name: string;
  stock_physical: number | null;
  stock_system: number;
  cost_per_unit: number;
}

const normalizeRef = (r: string) => r.trim().toLowerCase();

// Ajuste atómico de stock físico (stock = stock + delta en el UPDATE, sin
// read-modify-write) → dos operarios despachando a la vez no se pisan.
// Si el RPC todavía no existe en la base (migración sin aplicar), cae al
// método viejo: leer el stock actual y escribir el valor absoluto.
async function adjustStockPhysical(productId: string, delta: number, fallbackCurrent: number): Promise<void> {
  if (delta === 0) return;
  const { error } = await (supabase.rpc as any)('apply_stock_delta', { p_product_id: productId, p_delta: delta });
  if (!error) return;
  const missingFn = /function|schema cache|not.*found|404/i.test(String(error.message || error.code || ''));
  if (!missingFn) throw error;
  const { error: upError } = await supabase
    .from('inventory_products')
    .update({ stock_physical: fallbackCurrent + delta })
    .eq('id', productId);
  if (upError) throw upError;
}

/**
 * Alias confirmados a mano (tabla product_aliases): "lo que digita bodega" →
 * "la ref del maestro". Compartidos con el conteo físico: lo que Lina une una
 * vez en una remisión ya sale cruzado en la siguiente y en el conteo.
 */
export async function fetchRefAliases(): Promise<Map<string, string>> {
  // Sin filtro user_id: RLS ya resuelve por current_data_owner().
  const { data } = await (supabase as any)
    .from('product_aliases')
    .select('alias, ref_siigo');
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { alias: string; ref_siigo: string }[]) {
    if (r.alias && r.ref_siigo) map.set(normalizeRef(r.alias), r.ref_siigo);
  }
  return map;
}

/** Guarda (o pisa) el mapeo alias → ref del maestro. */
export async function saveRefAlias(alias: string, refSiigo: string): Promise<void> {
  // user_id lo reescribe al owner el trigger set_user_id_to_data_owner_trg;
  // mandamos null para no depender de que el caller conozca al owner.
  const { error } = await (supabase as any)
    .from('product_aliases')
    .upsert(
      { alias: alias.trim(), ref_siigo: refSiigo.trim() },
      { onConflict: 'user_id,alias' },
    );
  if (error) throw error;
}

export async function fetchProductsByRefs(
  _userId: string,
  refs: string[],
): Promise<Map<string, ProductLite>> {
  const uniqueRefs = Array.from(new Set(refs.map((r) => r.trim()).filter(Boolean)));
  if (uniqueRefs.length === 0) return new Map();

  // OJO: nada de .eq('user_id', ...) acá. La RLS de inventory_products filtra
  // por current_data_owner(), así que para un COLABORADOR (Lina) el user.id
  // que manda el frontend es el suyo propio y la intersección daba CERO filas:
  // toda la remisión salía "sin match" y no descontaba stock. El síntoma
  // delator era "PC635 ¿quisiste decir PC635?" — la sugerencia leía el
  // catálogo real (esa query nunca filtró por user_id) y el cruce no.
  const { data, error } = await supabase
    .from('inventory_products')
    .select('id, reference, name, stock_physical, stock_system, cost_per_unit')
    .in('reference', uniqueRefs);

  if (error) throw error;

  const map = new Map<string, ProductLite>();
  (data ?? []).forEach((p) => map.set(normalizeRef(p.reference), p as ProductLite));
  // Also check case-insensitive matches the DB missed (references stored in different case)
  const missing = uniqueRefs.filter((r) => !map.has(normalizeRef(r)));
  if (missing.length > 0) {
    const [{ data: allUserProducts }, aliases] = await Promise.all([
      supabase
        .from('inventory_products')
        .select('id, reference, name, stock_physical, stock_system, cost_per_unit'),
      fetchRefAliases().catch(() => new Map<string, string>()),
    ]);
    (allUserProducts ?? []).forEach((p) => {
      const key = normalizeRef(p.reference);
      if (!map.has(key) && missing.some((r) => normalizeRef(r) === key)) {
        map.set(key, p as ProductLite);
      }
    });

    const porRef = new Map<string, ProductLite>();
    (allUserProducts ?? []).forEach((p) => porRef.set(normalizeRef(p.reference), p as ProductLite));

    // ALIAS confirmados a mano: mandan sobre el cruce algorítmico porque son
    // una decisión explícita del usuario ("MN92 es MN-92, ya te lo dije").
    for (const r of missing) {
      const key = normalizeRef(r);
      if (map.has(key)) continue;
      const destino = aliases.get(key);
      if (!destino) continue;
      const prod = porRef.get(normalizeRef(destino))
        ?? [...porRef.values()].find((p) => refFamilyKey(p.reference) === refFamilyKey(destino));
      if (prod) map.set(key, prod);
    }

    // Cruce por FAMILIA (convención -5 de Siigo): la remisión despacha por
    // color o en mate ("PC635", "PC635-3") pero el maestro solo tiene la -5
    // ("PC635-5"). Es la MISMA pieza — el stock del producto vive en la -5 y
    // ahí se descuenta; el detalle por color lo lleva el ledger de variantes.
    // Sin esto, media remisión salía como "sin match" y no descontaba stock.
    const porFamilia = new Map<string, ProductLite>();
    (allUserProducts ?? []).forEach((p) => {
      const fam = refFamilyKey(p.reference);
      if (fam && !porFamilia.has(fam)) porFamilia.set(fam, p as ProductLite);
    });
    for (const r of missing) {
      const key = normalizeRef(r);
      if (map.has(key)) continue;
      const prod = porFamilia.get(refFamilyKey(r));
      if (prod) map.set(key, prod); // llave = ref TAL COMO se pidió
    }
  }
  return map;
}

export interface CreateProductInput {
  reference: string;
  name: string;
  unit_cost: number;
}

export async function createMissingProducts(
  userId: string,
  toCreate: CreateProductInput[],
): Promise<Map<string, ProductLite>> {
  if (toCreate.length === 0) return new Map();
  const rows = toCreate.map((p) => ({
    user_id: userId,
    reference: p.reference,
    name: p.name || p.reference,
    cost_per_unit: p.unit_cost || 0,
    stock_system: 0,
    stock_physical: 0,
    unit: 'unidad',
  }));
  const { data, error } = await supabase
    .from('inventory_products')
    .insert(rows)
    .select('id, reference, name, stock_physical, stock_system, cost_per_unit');
  if (error) throw error;
  const map = new Map<string, ProductLite>();
  (data ?? []).forEach((p) => map.set(normalizeRef(p.reference), p as ProductLite));
  return map;
}

export interface ApplyRemisionInput {
  userId: string;
  remisionId: string;
  remisionType: RemisionType;
  movementDate: string;
  items: RemisionItemInput[];
  productMap: Map<string, ProductLite>;
  /** created_at real de la remisión — para re-aplicar tras una EDICIÓN sin
   *  resucitar salidas que un conteo posterior ya absorbió. Omitir al crear. */
  remisionCreatedAt?: string;
}

export interface ApplyRemisionResult {
  /** Ítems aplicados a inventory_products (solo productos NO -5). */
  applied: number;
  unmatched: RemisionItemInput[];
  /** Variantes descontadas en el ledger referencia-por-referencia (el
   *  inventario físico real — el -5 no se toca por remisión). */
  variantesAplicadas: number;
}

export async function applyRemisionInventory({
  userId,
  remisionId,
  remisionType,
  movementDate,
  items,
  productMap,
  remisionCreatedAt,
}: ApplyRemisionInput): Promise<ApplyRemisionResult> {
  const movementType = remisionType === 'compra' ? 'entrada' : 'salida';
  const sign = remisionType === 'compra' ? 1 : -1;

  const matched: { item: RemisionItemInput; product: ProductLite }[] = [];
  const unmatched: RemisionItemInput[] = [];

  for (const item of items) {
    const product = productMap.get(normalizeRef(item.reference));
    if (!product) { unmatched.push(item); continue; }
    // REGLA (Nico, 2026-07-24): el -5 es el mundo Siigo — SOLO se mueve al
    // facturar, NUNCA por remisión (ni siquiera si el Excel trae la -5 tal
    // cual). El match (exacto o por familia) sirve para reconocer la
    // referencia — nombre, costo, nada de "sin match" falsos — pero el stock
    // físico de la remisión lo lleva el inventario POR VARIANTE.
    if (/-5$/i.test((product.reference ?? '').trim())) continue;
    matched.push({ item, product });
  }

  if (matched.length === 0) {
    // Nada que aplicar a products — el ledger de variantes igual registra.
    let variantesAplicadas = 0;
    try {
      const v = await applyVariantRemision({
        remisionId,
        remisionType,
        movementDate,
        items: items.map((i) => ({ reference: i.reference, units: i.units })),
        remisionCreatedAt,
      });
      variantesAplicadas = v.applied;
    } catch (e) {
      console.warn('[variantes] remisión no aplicada al inventario por variante:', e);
    }
    return { applied: 0, unmatched, variantesAplicadas };
  }

  const movementRows = matched.map(({ item, product }) => ({
    user_id: userId,
    product_id: product.id,
    movement_type: movementType,
    movement_date: movementDate,
    quantity: item.units,
    unit_cost: item.unit_cost,
    total_cost: item.units * item.unit_cost,
    source_type: 'remision' as const,
    source_id: remisionId,
  }));

  const { error: mvError } = await supabase
    .from('inventory_movements')
    .insert(movementRows as never);
  if (mvError) throw mvError;

  // Aggregate delta per product (same ref can repeat across items)
  const deltaByProduct = new Map<string, number>();
  for (const { item, product } of matched) {
    const prev = deltaByProduct.get(product.id) ?? 0;
    deltaByProduct.set(product.id, prev + sign * item.units);
  }

  for (const [productId, delta] of deltaByProduct.entries()) {
    const product = matched.find((m) => m.product.id === productId)!.product;
    await adjustStockPhysical(productId, delta, product.stock_physical ?? 0);
  }

  // Inventario por VARIANTE (control interno, sin -5): la referencia del item
  // ya trae el sufijo de color tal como se despachó. Best-effort — no-op si
  // la maestra no está sembrada; un fallo acá NO tumba el despacho (el -5 ya
  // quedó aplicado; el ledger de variantes se re-cuadra con la maestra).
  let variantesAplicadas = 0;
  try {
    const v = await applyVariantRemision({
      remisionId,
      remisionType,
      movementDate,
      items: items.map((i) => ({ reference: i.reference, units: i.units })),
      remisionCreatedAt,
    });
    variantesAplicadas = v.applied;
  } catch (e) {
    console.warn('[variantes] remisión no aplicada al inventario por variante:', e);
  }

  return { applied: matched.length, unmatched, variantesAplicadas };
}

// Reverse all movements sourced from a remisión: undo stock_physical deltas and delete the movement rows.
// opts.skipVariantes: solo revierte el -5 — para el flujo de EDICIÓN, donde el
// ledger por variante se concilia por diff (applyVariantRemision) sin borrar
// filas absorbidas por conteos ni desacomodar el stock cacheado.
export async function reverseRemisionInventory(
  remisionId: string,
  opts?: { skipVariantes?: boolean },
): Promise<void> {
  const { data: movements, error } = await supabase
    .from('inventory_movements')
    .select('id, product_id, movement_type, quantity')
    .eq('source_type' as never, 'remision')
    .eq('source_id' as never, remisionId);
  if (error) throw error;
  const rows = (movements ?? []) as Array<{
    id: string; product_id: string; movement_type: string; quantity: number;
  }>;
  if (rows.length === 0) return;

  const deltaByProduct = new Map<string, number>();
  for (const m of rows) {
    const sign = m.movement_type === 'entrada' ? -1 : 1; // reverse the original sign
    const prev = deltaByProduct.get(m.product_id) ?? 0;
    deltaByProduct.set(m.product_id, prev + sign * Number(m.quantity));
  }

  const productIds = Array.from(deltaByProduct.keys());
  const { data: products } = await supabase
    .from('inventory_products')
    .select('id, stock_physical')
    .in('id', productIds);

  for (const p of (products ?? []) as Array<{ id: string; stock_physical: number | null }>) {
    const delta = deltaByProduct.get(p.id) ?? 0;
    if (delta === 0) continue;
    await adjustStockPhysical(p.id, delta, p.stock_physical ?? 0);
  }

  const ids = rows.map((r) => r.id);
  await supabase.from('inventory_movements').delete().in('id', ids);

  // Revertir también el ledger por variante (best-effort, mismo criterio).
  if (!opts?.skipVariantes) {
    try {
      await reverseVariantRemision(remisionId);
    } catch (e) {
      console.warn('[variantes] no se pudo revertir la remisión en el inventario por variante:', e);
    }
  }
}
