import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export interface ResponsibleWithSalesFlag {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  nit: string | null;
  active: boolean;
  has_sales_history: boolean;
}

/**
 * Lista de responsibles activos del usuario con flag indicando si ya tuvieron
 * al menos una invoice.type='venta' (es decir, son clientes históricos).
 *
 * Se sirve desde la vista `responsibles_with_sales_flag` creada en la migración
 * 20260507150000_quotations_module.sql.
 */
export function useResponsiblesWithSalesFlag(opts?: { onlyActive?: boolean }) {
  const { user } = useAuth();
  const onlyActive = opts?.onlyActive ?? true;

  return useQuery({
    queryKey: ['responsibles-with-sales-flag', user?.id, onlyActive],
    enabled: !!user?.id,
    queryFn: async (): Promise<ResponsibleWithSalesFlag[]> => {
      let q = (supabase
        .from('responsibles_with_sales_flag' as never)
        .select('id, name, email, phone, address, nit, active, has_sales_history')
        .order('has_sales_history', { ascending: false })
        .order('name', { ascending: true })) as any;
      if (onlyActive) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as ResponsibleWithSalesFlag[]);
    },
  });
}
