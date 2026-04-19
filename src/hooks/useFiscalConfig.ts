import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface FiscalConfig {
  id: string;
  user_id: string;
  nit_digit: number | null;
  ica_periodicity: 'bimestral' | 'anual';
  ica_city: string;
  renta_type: 'juridica' | 'natural';
  created_at: string;
  updated_at: string;
}

export interface FiscalConfigInput {
  nit_digit?: number | null;
  ica_periodicity?: 'bimestral' | 'anual';
  ica_city?: string;
  renta_type?: 'juridica' | 'natural';
}

export function useFiscalConfig() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['fiscal-config', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await (supabase as any)
        .from('fiscal_config')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as FiscalConfig | null;
    },
    enabled: !!user?.id,
  });

  const saveConfig = useMutation({
    mutationFn: async (input: FiscalConfigInput) => {
      const payload = { ...input, user_id: user!.id };
      const { data, error } = await (supabase as any)
        .from('fiscal_config')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as FiscalConfig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-config'] });
      toast.success('Configuración fiscal guardada');
    },
    onError: (err: any) => {
      toast.error(`Error al guardar: ${err.message}`);
    },
  });

  return { config, isLoading, saveConfig };
}
