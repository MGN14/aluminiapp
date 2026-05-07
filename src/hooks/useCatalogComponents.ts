import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export interface InventoryProductLite {
  id: string;
  reference: string;
  name: string;
  unit: string | null;
  system: string | null;
  cost_per_unit: number;
  sale_price: number;
}

export interface CatalogComponent {
  id: string;
  catalog_id: string;
  product_id: string;
  quantity_per_m2: number;
  notes: string | null;
  sort_order: number;
  // Datos del producto inventory (join)
  product: InventoryProductLite | null;
}

const COMPONENTS_KEY = 'catalog-components';
const INV_BY_SYSTEM_KEY = 'inventory-by-system';

/** Componentes (BOM) de un producto del catálogo. */
export function useCatalogComponents(catalogId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [COMPONENTS_KEY, catalogId, user?.id],
    enabled: !!user?.id && !!catalogId,
    queryFn: async (): Promise<CatalogComponent[]> => {
      const { data, error } = await (supabase
        .from('aluminum_catalog_components' as never)
        .select(
          `
          id, catalog_id, product_id, quantity_per_m2, notes, sort_order,
          product:product_id (
            id, reference, name, unit, system, cost_per_unit, sale_price
          )
        `,
        )
        .eq('catalog_id', catalogId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }) as any);
      if (error) throw error;
      return ((data ?? []) as CatalogComponent[]);
    },
  });
}

/** Productos del inventario filtrados por sistema (para el picker del catálogo). */
export function useInventoryBySystem(system: string | null | undefined) {
  const { user } = useAuth();
  const sys = (system ?? '').trim();

  return useQuery({
    queryKey: [INV_BY_SYSTEM_KEY, sys, user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<InventoryProductLite[]> => {
      let q = supabase
        .from('inventory_products')
        .select('id, reference, name, unit, system, cost_per_unit, sale_price')
        .eq('active', true)
        .order('name', { ascending: true }) as any;
      if (sys) q = q.eq('system', sys);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as InventoryProductLite[]);
    },
  });
}

export function useCatalogComponentMutations() {
  const qc = useQueryClient();

  const add = useMutation({
    mutationFn: async (params: {
      catalog_id: string;
      product_id: string;
      quantity_per_m2: number;
      notes?: string | null;
    }) => {
      const { error } = await (supabase
        .from('aluminum_catalog_components' as never)
        .insert({
          catalog_id: params.catalog_id,
          product_id: params.product_id,
          quantity_per_m2: params.quantity_per_m2,
          notes: params.notes?.trim() || null,
        } as never) as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [COMPONENTS_KEY] }),
  });

  const update = useMutation({
    mutationFn: async (params: {
      id: string;
      patch: Partial<{ quantity_per_m2: number; notes: string | null }>;
    }) => {
      const { error } = await (supabase
        .from('aluminum_catalog_components' as never)
        .update(params.patch as never)
        .eq('id', params.id) as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [COMPONENTS_KEY] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('aluminum_catalog_components' as never)
        .delete()
        .eq('id', id) as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [COMPONENTS_KEY] }),
  });

  return { add, update, remove };
}
