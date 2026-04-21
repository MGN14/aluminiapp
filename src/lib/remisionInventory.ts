import { supabase } from '@/integrations/supabase/client';

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

export async function fetchProductsByRefs(
  userId: string,
  refs: string[],
): Promise<Map<string, ProductLite>> {
  const uniqueRefs = Array.from(new Set(refs.map((r) => r.trim()).filter(Boolean)));
  if (uniqueRefs.length === 0) return new Map();

  const { data, error } = await supabase
    .from('inventory_products')
    .select('id, reference, name, stock_physical, stock_system, cost_per_unit')
    .eq('user_id', userId)
    .in('reference', uniqueRefs);

  if (error) throw error;

  const map = new Map<string, ProductLite>();
  (data ?? []).forEach((p) => map.set(normalizeRef(p.reference), p as ProductLite));
  // Also check case-insensitive matches the DB missed (references stored in different case)
  const missing = uniqueRefs.filter((r) => !map.has(normalizeRef(r)));
  if (missing.length > 0) {
    const { data: allUserProducts } = await supabase
      .from('inventory_products')
      .select('id, reference, name, stock_physical, stock_system, cost_per_unit')
      .eq('user_id', userId);
    (allUserProducts ?? []).forEach((p) => {
      const key = normalizeRef(p.reference);
      if (!map.has(key) && missing.some((r) => normalizeRef(r) === key)) {
        map.set(key, p as ProductLite);
      }
    });
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
}

export interface ApplyRemisionResult {
  applied: number;
  unmatched: RemisionItemInput[];
}

export async function applyRemisionInventory({
  userId,
  remisionId,
  remisionType,
  movementDate,
  items,
  productMap,
}: ApplyRemisionInput): Promise<ApplyRemisionResult> {
  const movementType = remisionType === 'compra' ? 'entrada' : 'salida';
  const sign = remisionType === 'compra' ? 1 : -1;

  const matched: { item: RemisionItemInput; product: ProductLite }[] = [];
  const unmatched: RemisionItemInput[] = [];

  for (const item of items) {
    const product = productMap.get(normalizeRef(item.reference));
    if (product) matched.push({ item, product });
    else unmatched.push(item);
  }

  if (matched.length === 0) {
    return { applied: 0, unmatched };
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
    const currentPhysical = product.stock_physical ?? 0;
    const newPhysical = currentPhysical + delta;
    const { error: upError } = await supabase
      .from('inventory_products')
      .update({ stock_physical: newPhysical })
      .eq('id', productId);
    if (upError) throw upError;
  }

  return { applied: matched.length, unmatched };
}

// Reverse all movements sourced from a remisión: undo stock_physical deltas and delete the movement rows.
export async function reverseRemisionInventory(remisionId: string): Promise<void> {
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
    const current = p.stock_physical ?? 0;
    await supabase
      .from('inventory_products')
      .update({ stock_physical: current + delta })
      .eq('id', p.id);
  }

  const ids = rows.map((r) => r.id);
  await supabase.from('inventory_movements').delete().in('id', ids);
}
