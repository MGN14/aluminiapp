// F4 pestaña Escenarios — guardar/listar/borrar escenarios con nombre.
// Data 100% serializable (regla de la casa: nada de Map/Set en queries).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ScenarioSnapshot {
  trmHoy: number | null;
  vigente?: {
    label: string;
    saldoUsd: number;
    saldoCop: number | null;
    cajaParaCerrar: number | null;
  } | null;
  siguiente?: {
    totalCop: number | null;
    copPorKg: number | null;
    mercanciaUsd: number | null;
    llegada: string | null;
  } | null;
}

export interface ImportScenario {
  id: string;
  nombre: string;
  trm: number | null;
  smm_usd_ton: number | null;
  flete_usd: number | null;
  import_id: string | null;
  snapshot: ScenarioSnapshot;
  notas: string | null;
  created_at: string;
}

export interface NewImportScenario {
  nombre: string;
  trm: number | null;
  smm_usd_ton: number | null;
  flete_usd: number | null;
  import_id: string | null;
  snapshot: ScenarioSnapshot;
  notas?: string | null;
}

export function useImportScenarios() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['import-scenarios', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ImportScenario[]> => {
      const { data, error } = await (supabase as any)
        .from('import_scenarios')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        nombre: r.nombre ?? '',
        trm: r.trm != null ? Number(r.trm) : null,
        smm_usd_ton: r.smm_usd_ton != null ? Number(r.smm_usd_ton) : null,
        flete_usd: r.flete_usd != null ? Number(r.flete_usd) : null,
        import_id: r.import_id ?? null,
        snapshot: (r.snapshot ?? {}) as ScenarioSnapshot,
        notas: r.notas ?? null,
        created_at: r.created_at,
      }));
    },
  });

  const save = useMutation({
    mutationFn: async (input: NewImportScenario) => {
      const { error } = await (supabase as any).from('import_scenarios').insert({
        ...input,
        user_id: user!.id, // el trigger lo re-mapea al owner si es colaborador
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['import-scenarios'] });
      toast.success('Escenario guardado');
    },
    onError: (e) => toast.error(`No se pudo guardar: ${(e as Error).message}`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('import_scenarios').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-scenarios'] }),
    onError: (e) => toast.error(`Error: ${(e as Error).message}`),
  });

  return { scenarios: query.data ?? [], isLoading: query.isLoading, save, remove };
}
