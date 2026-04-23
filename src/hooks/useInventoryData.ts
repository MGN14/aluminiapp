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
}

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
}

function classifyStatus(daysOfInventory: number, avgDailySales: number): InventoryStatus {
  if (avgDailySales <= 0) return 'exceso'; // no sales = stuck
  if (daysOfInventory < 15) return 'critico';
  if (daysOfInventory <= 45) return 'alerta';
  if (daysOfInventory <= 90) return 'sano';
  return 'exceso';
}

export function useInventoryData() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductWithMetrics[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<InventoryMetrics>({
    totalValue: 0, avgDaysOfInventory: 0, avgRotation: 0,
    pctNoMovement: 0, totalDifference: 0, totalDifferenceValue: 0,
    totalProducts: 0, criticalCount: 0, excessCount: 0,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      const [prodRes, movRes] = await Promise.all([
        supabase.from('inventory_products').select('*').eq('user_id', user.id).eq('active', true).order('reference'),
        supabase.from('inventory_movements').select('*').eq('user_id', user.id).order('movement_date', { ascending: false }),
      ]);

      if (prodRes.error) throw prodRes.error;
      if (movRes.error) throw movRes.error;

      const rawProducts = (prodRes.data || []) as InventoryProduct[];
      const rawMovements = (movRes.data || []) as InventoryMovement[];
      setMovements(rawMovements);

      // Calculate metrics per product
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const enriched: ProductWithMetrics[] = rawProducts.map(p => {
        const productMovements = rawMovements.filter(m => m.product_id === p.id);
        const recentSales = productMovements
          .filter(m => m.movement_type === 'salida' && new Date(m.movement_date) >= thirtyDaysAgo)
          .reduce((sum, m) => sum + Math.abs(m.quantity), 0);

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
    const product = products.find(p => p.id === movement.product_id);
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
  };
}
