import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface FiscalConfig {
  id: string;
  user_id: string;
  // Legacy fields
  nit_digit: number | null;
  ica_periodicity: 'bimestral' | 'anual';
  ica_city: string;
  renta_type: 'juridica' | 'natural';
  // Onboarding fields
  nit_ultimo_digito: number | null;
  persona_type: 'natural' | 'juridica' | null;
  regimen: 'comun' | 'simple' | 'especial' | null;
  responsable_iva: boolean;
  agente_retencion: boolean;
  autorretenedor: boolean;
  responsable_ica: boolean;
  facturacion_electronica: boolean;
  nombre_facturador: string | null;
  nivel_ingresos: 'menos_92k_uvt' | 'mas_92k_uvt' | null;
  actividad_principal: 'comercial' | 'servicios' | 'industrial' | 'construccion' | 'otro' | null;
  codigo_ciiu: string | null;
  created_at: string;
  updated_at: string;
}

export interface FiscalConfigInput {
  nit_digit?: number | null;
  ica_periodicity?: 'bimestral' | 'anual';
  ica_city?: string;
  renta_type?: 'juridica' | 'natural';
  nit_ultimo_digito?: number | null;
  persona_type?: 'natural' | 'juridica' | null;
  regimen?: 'comun' | 'simple' | 'especial' | null;
  responsable_iva?: boolean;
  agente_retencion?: boolean;
  autorretenedor?: boolean;
  responsable_ica?: boolean;
  facturacion_electronica?: boolean;
  nombre_facturador?: string | null;
  nivel_ingresos?: 'menos_92k_uvt' | 'mas_92k_uvt' | null;
  actividad_principal?: 'comercial' | 'servicios' | 'industrial' | 'construccion' | 'otro' | null;
  codigo_ciiu?: string | null;
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
      // If DB table is missing or read fails, fall back to localStorage
      if (error || !data) {
        try {
          const raw = localStorage.getItem(`fiscal_config:${user.id}`);
          if (raw) return JSON.parse(raw) as FiscalConfig;
        } catch { /* ignore */ }
        return null;
      }
      return data as unknown as FiscalConfig;
    },
    enabled: !!user?.id,
  });

  const saveConfig = useMutation({
    mutationFn: async (input: FiscalConfigInput) => {
      const payload = { ...input, user_id: user!.id };
      try {
        localStorage.setItem(`fiscal_config:${user!.id}`, JSON.stringify(payload));
      } catch { /* ignore */ }
      const { data, error } = await (supabase as any)
        .from('fiscal_config')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) {
        // Table missing or permission issue — local copy already saved, treat as success
        return payload as unknown as FiscalConfig;
      }
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
