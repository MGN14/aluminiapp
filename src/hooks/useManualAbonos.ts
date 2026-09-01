// Abonos manuales del tablero Escenarios — "abonos no reales": plata que se
// movió pero no está en la contabilidad. Solo los usa la pestaña Escenarios;
// los reales (import_payments) se administran en Pedidos.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ManualAbono {
  id: string;
  import_id: string;
  fecha: string;
  descripcion: string;
  cop: number;
  trm: number;
}

export function useManualAbonos() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['import-manual-abonos', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ManualAbono[]> => {
      const { data, error } = await (supabase as any)
        .from('import_manual_abonos')
        .select('id, import_id, fecha, descripcion, cop, trm')
        .order('fecha', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, import_id: r.import_id, fecha: r.fecha,
        descripcion: r.descripcion ?? '', cop: Number(r.cop) || 0, trm: Number(r.trm) || 0,
      }));
    },
  });

  const add = useMutation({
    mutationFn: async (input: { import_id: string; fecha: string; descripcion: string; cop: number; trm: number }) => {
      const { error } = await (supabase as any).from('import_manual_abonos')
        .insert({ ...input, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['import-manual-abonos'] }); toast.success('Abono manual anotado (solo en este tablero)'); },
    onError: (e) => toast.error(`No se pudo anotar: ${(e as Error).message}`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('import_manual_abonos').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-manual-abonos'] }),
    onError: (e) => toast.error(`Error: ${(e as Error).message}`),
  });

  return { abonos: query.data ?? [], add, remove };
}
