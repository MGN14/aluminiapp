import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface InventoryProduct {
  id: string;
  reference: string;
  name: string;
  unit: string;
  stock_system: number;
  stock_physical: number | null;
  cost_per_unit: number;
  sale_price: number;
  min_stock: number;
  last_count_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  source?: 'manual' | 'siigo';
  siigo_id?: string | null;
  last_siigo_sync_at?: string | null;
  /** Sistema/grupo al que pertenece la referencia (ej: "744", "8025", "proyectante"). */
  system?: string | null;
}

export type InventoryDataSource = 'dian' | 'gerencial';

export interface InventoryMovement {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  invoice_id: string | null;
  notes: string | null;
  movement_date: string;
  created_at: string;
}

export type InventoryStatus = 'critico' | 'alerta' | 'sano' | 'exceso';

export interface ProductWithMetrics extends InventoryProduct {
  difference: number;
  days_of_inventory: number;
  rotation: number;
  status: InventoryStatus;
  avg_daily_sales: number;
}

export interface InventoryMetrics {
  totalValue: number;
  avgDaysOfInventory: number;
  avgRotation: number;
  pctNoMovement: number;
  totalDifference: number;
  totalDifferenceValue: number;
  totalProducts: number;
  criticalCount: number;
  excessCount: number;
  /** false cuando no hay ningun inventory_movement registrado — los KPIs
   *  de "Días de Inventario" y "Sin Movimiento" no son confiables y la UI
   *  debe mostrar "—" en lugar de 0d/100%. */
  hasMovementData: boolean;
}

function classifyStatus(daysOfInventory: number, avgDailySales: number): InventoryStatus {
  if (avgDailySales <= 0) return 'exceso'; // no sales = stuck
  if (daysOfInventory < 15) return 'critico';
  if (daysOfInventory <= 45) return 'alerta';
  if (daysOfInventory <= 90) return 'sano';
  return 'exceso';
}

/**
 * Hook de inventario.
 *
 * @param dataSource Fuente para calcular ventas/rotación de los últimos 30 días:
 *   - 'dian': usa invoice_items de invoices type='venta' (lo que ven la DIAN y los bancos)
 *   - 'gerencial': usa remision_items de remisiones module_origin='gerencial' (operativo real)
 * Si se omite, usa 'dian' (default seguro).
 */
export function useInventoryData(dataSource: InventoryDataSource = 'dian') {
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductWithMetrics[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<InventoryMetrics>({
    totalValue: 0, avgDaysOfInventory: 0, avgRotation: 0,
    pctNoMovement: 0, totalDifference: 0, totalDifferenceValue: 0,
    totalProducts: 0, criticalCount: 0, excessCount: 0,
    hasMovementData: false,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().split('T')[0];

      // 1. Catálogo + historial completo de movimientos (para auditoría y compatibilidad)
      const [prodRes, movRes] = await Promise.all([
        supabase.from('inventory_products').select('*').eq('user_id', user.id).eq('active', true).order('reference'),
        supabase.from('inventory_movements').select('*').eq('user_id', user.id).order('movement_date', { ascending: false }),
      ]);

      if (prodRes.error) throw prodRes.error;
      if (movRes.error) throw movRes.error;

      const rawProducts = (prodRes.data || []) as InventoryProduct[];
      const rawMovements = (movRes.data || []) as InventoryMovement[];
      setMovements(rawMovements);

      // 2. Ventas de los últimos 30 días según fuente del modo activo.
      //    Devuelve Map<reference_normalizada, total_unidades>.
      const recentSalesByRef = await loadRecentSalesByReference(
        user.id,
        dataSource,
        thirtyDaysAgoIso,
      );

      const enriched: ProductWithMetrics[] = rawProducts.map(p => {
        const refKey = (p.reference ?? '').trim().toLowerCase();
        const recentSales = recentSalesByRef.get(refKey) ?? 0;

        const avgDailySales = recentSales / 30;
        const daysOfInventory = avgDailySales > 0 ? p.stock_system / avgDailySales : 999;
        const totalSales30d = recentSales;
        const avgStock = p.stock_system > 0 ? p.stock_system : 1;
        const rotation = totalSales30d / avgStock;
        const difference = p.stock_physical !== null ? p.stock_system - p.stock_physical : 0;

        return {
          ...p,
          difference,
          days_of_inventory: Math.round(daysOfInventory),
          rotation: Math.round(rotation * 100) / 100,
          status: classifyStatus(daysOfInventory, avgDailySales),
          avg_daily_sales: Math.round(avgDailySales * 100) / 100,
        };
      });

      setProducts(enriched);

      // Aggregate metrics
      const totalValue = enriched.reduce((s, p) => s + p.stock_system * p.cost_per_unit, 0);
      const withSales = enriched.filter(p => p.avg_daily_sales > 0);
      const avgDays = withSales.length > 0
        ? withSales.reduce((s, p) => s + p.days_of_inventory, 0) / withSales.length
        : 0;
      const avgRot = enriched.length > 0
        ? enriched.reduce((s, p) => s + p.rotation, 0) / enriched.length
        : 0;
      const noMovement = enriched.filter(p => p.avg_daily_sales === 0).length;
      const pctNo = enriched.length > 0 ? (noMovement / enriched.length) * 100 : 0;
      const totalDiff = enriched.reduce((s, p) => s + Math.abs(p.difference), 0);
      const totalDiffValue = enriched.reduce((s, p) => s + Math.abs(p.difference) * (p.cost_per_unit || 0), 0);

      // hasMovementData refleja si la FUENTE ACTIVA (DIAN/Gerencial) tiene
      // ventas en los últimos 30d. Si no hay, "Días de Inventario" y
      // "Sin Movimiento" no son confiables y la UI los muestra como "—".
      const hasMovementData = recentSalesByRef.size > 0;

      setMetrics({
        totalValue,
        avgDaysOfInventory: Math.round(avgDays),
        avgRotation: Math.round(avgRot * 100) / 100,
        pctNoMovement: Math.round(pctNo),
        totalDifference: totalDiff,
        totalDifferenceValue: totalDiffValue,
        totalProducts: enriched.length,
        criticalCount: enriched.filter(p => p.status === 'critico').length,
        excessCount: enriched.filter(p => p.status === 'exceso').length,
        hasMovementData,
      });
    } catch (err: any) {
      toast({ title: 'Error cargando inventario', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addProduct = async (product: Omit<InventoryProduct, 'id' | 'created_at' | 'updated_at' | 'active' | 'last_count_date' | 'stock_physical'>) => {
    if (!user) return;
    const { error } = await supabase.from('inventory_products').insert({ ...product, user_id: user.id });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  const updateProduct = async (id: string, updates: Partial<InventoryProduct>) => {
    if (!user) return;
    const { error } = await supabase.from('inventory_products').update(updates).eq('id', id).eq('user_id', user.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  const addMovement = async (movement: { product_id: string; movement_type: string; quantity: number; unit_cost: number; notes?: string; movement_date?: string }) => {
    if (!user) return;

    // Validación pre-insert: bloquear salidas que dejarían stock negativo.
    // Idealmente esto va respaldado por trigger SQL para resistir concurrencia,
    // pero el check cliente cubre el caso single-user típico.
    const product = products.find(p => p.id === movement.product_id);
    if (product && movement.movement_type === 'salida') {
      const projected = product.stock_system - movement.quantity;
      if (projected < 0) {
        toast({
          title: 'Stock insuficiente',
          description: `Stock actual: ${product.stock_system}. Intentás retirar: ${movement.quantity}.`,
          variant: 'destructive',
        });
        return false;
      }
    }

    const totalCost = movement.quantity * movement.unit_cost;
    const { error: movErr } = await supabase.from('inventory_movements').insert({
      ...movement,
      total_cost: totalCost,
      user_id: user.id,
      movement_date: movement.movement_date || new Date().toISOString().split('T')[0],
    });
    if (movErr) {
      toast({ title: 'Error', description: movErr.message, variant: 'destructive' });
      return false;
    }

    // Update stock
    if (product) {
      let newStock = product.stock_system;
      if (movement.movement_type === 'entrada') newStock += movement.quantity;
      else if (movement.movement_type === 'salida') newStock -= movement.quantity;
      else newStock = movement.quantity; // ajuste = set to quantity

      await supabase.from('inventory_products')
        .update({ stock_system: newStock })
        .eq('id', movement.product_id)
        .eq('user_id', user.id);
    }

    await fetchData();
    return true;
  };

  const deleteProduct = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from('inventory_products').update({ active: false }).eq('id', id).eq('user_id', user.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  return {
    products, movements, metrics, loading,
    addProduct, updateProduct, addMovement, deleteProduct, refetch: fetchData,
    dataSource,
  };
}

/**
 * Carga ventas de los últimos N días según la fuente del modo activo.
 *
 * - DIAN: invoice_items de invoices type='venta' confirmadas en el período.
 *   Es lo que ve la DIAN y lo que reportan los bancos.
 * - Gerencial: remision_items de remisiones module_origin='gerencial' y
 *   remision_type='venta' en el período. Es el flujo operativo real.
 *
 * Devuelve Map<reference normalizada (lowercase + trim), total_unidades>.
 */
async function loadRecentSalesByReference(
  userId: string,
  source: InventoryDataSource,
  sinceIso: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  if (source === 'dian') {
    // invoice_items <- invoices (type='venta', issue_date >= sinceIso)
    const { data, error } = await supabase
      .from('invoice_items')
      .select('reference, quantity, invoices!inner(issue_date, type, user_id)')
      .eq('user_id', userId)
      .eq('invoices.user_id', userId)
      .eq('invoices.type', 'venta')
      .gte('invoices.issue_date', sinceIso);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ reference: string | null; quantity: number | null }>) {
      if (!row.reference) continue;
      const k = row.reference.trim().toLowerCase();
      out.set(k, (out.get(k) ?? 0) + Math.abs(Number(row.quantity ?? 0)));
    }
    return out;
  }

  // gerencial
  const { data, error } = await supabase
    .from('remision_items')
    .select('reference, units, remisiones!inner(date, module_origin, remision_type, user_id, status)')
    .eq('remisiones.user_id', userId)
    .eq('remisiones.module_origin', 'gerencial')
    .eq('remisiones.remision_type', 'venta')
    .gte('remisiones.date', sinceIso);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ reference: string | null; units: number | null }>) {
    if (!row.reference) continue;
    const k = row.reference.trim().toLowerCase();
    out.set(k, (out.get(k) ?? 0) + Math.abs(Number(row.units ?? 0)));
  }
  return out;
}
