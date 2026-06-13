import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { computeDepreciation, type AssetCategory, type DepreciationResult } from '@/lib/depreciation';

export interface FixedAsset {
  id: string;
  nombre: string;
  categoria: AssetCategory;
  valor_compra: number;
  fecha_compra: string;
  vida_util_meses: number;
  valor_residual: number;
  activo: boolean;
  notas: string | null;
}

export type NewFixedAsset = Omit<FixedAsset, 'id'>;

export interface FixedAssetWithDep extends FixedAsset {
  dep: DepreciationResult;
}

export interface FixedAssetsSummary {
  assets: FixedAssetWithDep[];
  totalCompra: number;
  totalDepAcumulada: number;
  totalEnLibros: number;     // valor en libros total → va al Balance
  totalDepAnio: number;      // depreciación del año en curso (gasto)
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function useFixedAssets() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<FixedAssetsSummary>({
    queryKey: ['fixed-assets', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from('fixed_assets' as never) as any)
        .select('*').order('fecha_compra', { ascending: false });
      if (error) throw error;
      const rows = (((data as unknown) as FixedAsset[]) ?? []).map((r) => ({
        ...r,
        valor_compra: num(r.valor_compra),
        valor_residual: num(r.valor_residual),
        vida_util_meses: num(r.vida_util_meses),
      }));
      const assets: FixedAssetWithDep[] = rows.map((a) => ({ ...a, dep: computeDepreciation(a) }));
      // Solo activos en uso suman al balance.
      const enUso = assets.filter((a) => a.activo);
      return {
        assets,
        totalCompra: enUso.reduce((s, a) => s + a.valor_compra, 0),
        totalDepAcumulada: enUso.reduce((s, a) => s + a.dep.depAcumulada, 0),
        totalEnLibros: enUso.reduce((s, a) => s + a.dep.valorEnLibros, 0),
        totalDepAnio: enUso.reduce((s, a) => s + a.dep.depAnioActual, 0),
      };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fixed-assets', user?.id] });
    // El valor en libros alimenta el Balance General.
    qc.invalidateQueries({ queryKey: ['balance-sheet-v1'] });
  };

  const save = useMutation({
    mutationFn: async (input: NewFixedAsset & { id?: string }) => {
      if (!user) throw new Error('No auth');
      const row = {
        nombre: input.nombre.trim(),
        categoria: input.categoria,
        valor_compra: num(input.valor_compra),
        fecha_compra: input.fecha_compra,
        vida_util_meses: Math.max(1, Math.floor(num(input.vida_util_meses))),
        valor_residual: num(input.valor_residual),
        activo: input.activo,
        notas: input.notas?.trim() || null,
      };
      if (input.id) {
        const { error } = await (supabase.from('fixed_assets' as never) as any).update(row).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from('fixed_assets' as never) as any).insert({ ...row, user_id: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); toast.success('Activo guardado'); },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('fixed_assets' as never) as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Activo eliminado'); },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  });

  return useMemo(() => ({
    data: query.data,
    isLoading: query.isLoading,
    save,
    remove,
  }), [query.data, query.isLoading, save, remove]);
}
