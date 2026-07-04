import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { InventoryProductLite } from '@/hooks/useCatalogComponents';
import type {
  ProductTemplate,
  TemplateApertura,
  TemplatePiece,
  TemplateTipo,
} from '@/types/productTemplate';

const QUERY_KEY = 'product-templates';
const INV_BY_IDS_KEY = 'inventory-by-ids';

export interface TemplateInput {
  name: string;
  tipo: TemplateTipo;
  naves?: number;
  apertura?: TemplateApertura;
  system?: string | null;
  color?: string | null;
  description?: string | null;
  margen_pct?: number;
  desperdicio_pct?: number;
  piezas?: TemplatePiece[];
  active?: boolean;
}

export function useProductTemplates(opts?: { onlyActive?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const onlyActive = opts?.onlyActive ?? false;

  const query = useQuery({
    queryKey: [QUERY_KEY, user?.id, onlyActive],
    enabled: !!user?.id,
    queryFn: async (): Promise<ProductTemplate[]> => {
      let q = supabase
        .from('product_templates' as never)
        .select('*')
        .order('name', { ascending: true }) as any;
      if (onlyActive) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        ...row,
        piezas: Array.isArray(row.piezas) ? row.piezas : [],
      })) as ProductTemplate[];
    },
  });

  const createOne = useMutation({
    mutationFn: async (input: TemplateInput): Promise<ProductTemplate> => {
      if (!user) throw new Error('No autenticado');
      const { data, error } = await (supabase
        .from('product_templates' as never)
        .insert({
          user_id: user.id,
          name: input.name.trim(),
          tipo: input.tipo,
          naves: input.naves ?? 2,
          apertura: input.apertura ?? 'derecha',
          system: input.system?.trim() || null,
          color: input.color?.trim() || null,
          description: input.description?.trim() || null,
          margen_pct: input.margen_pct ?? 30,
          desperdicio_pct: input.desperdicio_pct ?? 10,
          piezas: input.piezas ?? [],
          active: input.active ?? true,
        } as never)
        .select('*')
        .single() as any);
      if (error) throw error;
      return data as ProductTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const updateOne = useMutation({
    mutationFn: async (params: { id: string; patch: Partial<TemplateInput> }) => {
      const patch: Record<string, unknown> = {};
      const p = params.patch;
      if (p.name !== undefined) patch.name = p.name.trim();
      if (p.tipo !== undefined) patch.tipo = p.tipo;
      if (p.naves !== undefined) patch.naves = p.naves;
      if (p.apertura !== undefined) patch.apertura = p.apertura;
      if (p.system !== undefined) patch.system = p.system?.trim() || null;
      if (p.color !== undefined) patch.color = p.color?.trim() || null;
      if (p.description !== undefined) patch.description = p.description?.trim() || null;
      if (p.margen_pct !== undefined) patch.margen_pct = p.margen_pct;
      if (p.desperdicio_pct !== undefined) patch.desperdicio_pct = p.desperdicio_pct;
      if (p.piezas !== undefined) patch.piezas = p.piezas;
      if (p.active !== undefined) patch.active = p.active;
      const { error } = await (supabase
        .from('product_templates' as never)
        .update(patch as never)
        .eq('id', params.id) as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const deleteOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('product_templates' as never)
        .delete()
        .eq('id', id) as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    createOne,
    updateOne,
    deleteOne,
  };
}

/**
 * Productos de inventario por ids (sin filtro de activo — las piezas de una
 * plantilla pueden referenciar productos luego desactivados y hay que poder
 * mostrarlos/costearlos igual). Devuelve además un Map por id para despiece.
 */
export function useInventoryByIds(ids: string[]) {
  const { user } = useAuth();
  const sorted = useMemo(() => Array.from(new Set(ids)).sort(), [ids]);

  const query = useQuery({
    queryKey: [INV_BY_IDS_KEY, user?.id, sorted.join(',')],
    enabled: !!user?.id && sorted.length > 0,
    queryFn: async (): Promise<InventoryProductLite[]> => {
      const { data, error } = await (supabase
        .from('inventory_products')
        .select('id, reference, name, unit, system, cost_per_unit, sale_price')
        .in('id', sorted) as any);
      if (error) throw error;
      return ((data ?? []) as InventoryProductLite[]);
    },
  });

  const byId = useMemo(() => {
    const map = new Map<string, InventoryProductLite>();
    (query.data ?? []).forEach((p) => map.set(p.id, p));
    return map;
  }, [query.data]);

  return { ...query, byId };
}
