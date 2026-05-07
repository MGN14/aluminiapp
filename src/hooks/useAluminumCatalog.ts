import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { AluminumCatalogEntry } from '@/types/quotation';

const QUERY_KEY = 'aluminum-catalog';

export interface CatalogInput {
  system: string;
  color: string;
  price_per_m2: number;
  description?: string | null;
  active?: boolean;
}

export function useAluminumCatalog(opts?: { onlyActive?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const onlyActive = opts?.onlyActive ?? false;

  const query = useQuery({
    queryKey: [QUERY_KEY, user?.id, onlyActive],
    queryFn: async (): Promise<AluminumCatalogEntry[]> => {
      let q = supabase
        .from('aluminum_catalog' as never)
        .select('*')
        .order('system', { ascending: true })
        .order('color', { ascending: true }) as any;
      if (onlyActive) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AluminumCatalogEntry[];
    },
    enabled: !!user?.id,
  });

  const createOne = useMutation({
    mutationFn: async (input: CatalogInput) => {
      if (!user) throw new Error('No autenticado');
      const { data, error } = await (supabase
        .from('aluminum_catalog' as never)
        .insert({
          user_id: user.id,
          system: input.system.trim(),
          color: input.color.trim(),
          price_per_m2: input.price_per_m2,
          description: input.description?.trim() || null,
          active: input.active ?? true,
        } as never)
        .select('*')
        .single() as any);
      if (error) throw error;
      return data as AluminumCatalogEntry;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const updateOne = useMutation({
    mutationFn: async (params: { id: string; patch: Partial<CatalogInput> }) => {
      const patch: Record<string, unknown> = {};
      if (params.patch.system !== undefined) patch.system = params.patch.system.trim();
      if (params.patch.color !== undefined) patch.color = params.patch.color.trim();
      if (params.patch.price_per_m2 !== undefined) patch.price_per_m2 = params.patch.price_per_m2;
      if (params.patch.description !== undefined)
        patch.description = params.patch.description?.trim() || null;
      if (params.patch.active !== undefined) patch.active = params.patch.active;
      const { error } = await (supabase
        .from('aluminum_catalog' as never)
        .update(patch as never)
        .eq('id', params.id) as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const deleteOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('aluminum_catalog' as never)
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
