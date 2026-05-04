import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type BusinessObligationTipo =
  | 'arriendo'
  | 'nomina'
  | 'pila'
  | 'servicios'
  | 'parafiscales'
  | 'cesantias'
  | 'otro';

export interface BusinessObligation {
  id: string;
  user_id: string;
  nombre: string;
  tipo: BusinessObligationTipo;
  dia_mes: number;
  monto_estimado: number | null;
  meses: string[]; // '1'..'12'
  activa: boolean;
  notas: string | null;
  completadas: string[]; // 'YYYY-MM'
  created_at: string;
  updated_at: string;
}

export interface NewBusinessObligation {
  nombre: string;
  tipo: BusinessObligationTipo;
  dia_mes: number;
  monto_estimado?: number | null;
  meses?: string[];
  activa?: boolean;
  notas?: string | null;
}

export const TIPO_LABELS: Record<BusinessObligationTipo, string> = {
  arriendo: 'Arriendo',
  nomina: 'Nómina',
  pila: 'Planilla PILA',
  servicios: 'Servicios públicos',
  parafiscales: 'Parafiscales',
  cesantias: 'Cesantías',
  otro: 'Otro',
};

export function useBusinessObligations() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: obligations = [], isLoading } = useQuery({
    queryKey: ['business-obligations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase as any)
        .from('business_obligations')
        .select('*')
        .order('dia_mes', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as BusinessObligation[];
    },
    enabled: !!user?.id,
  });

  const createObligation = useMutation({
    mutationFn: async (input: NewBusinessObligation) => {
      const { data, error } = await (supabase as any)
        .from('business_obligations')
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as BusinessObligation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-obligations'] });
      toast.success('Obligación creada');
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const updateObligation = useMutation({
    mutationFn: async ({ id, ...input }: Partial<BusinessObligation> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from('business_obligations')
        .update(input)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as BusinessObligation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-obligations'] });
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const deleteObligation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('business_obligations')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-obligations'] });
      toast.success('Obligación eliminada');
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const toggleMonthComplete = useMutation({
    mutationFn: async ({ id, mes, completed }: { id: string; mes: string; completed: boolean }) => {
      const ob = obligations.find(o => o.id === id);
      if (!ob) return;
      const set = new Set(ob.completadas || []);
      if (completed) set.add(mes); else set.delete(mes);
      const { error } = await (supabase as any)
        .from('business_obligations')
        .update({ completadas: Array.from(set) })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-obligations'] });
    },
  });

  return {
    obligations,
    isLoading,
    createObligation,
    updateObligation,
    deleteObligation,
    toggleMonthComplete,
  };
}
