// Precios de lista del maestro de inventario, indexados por FAMILIA de color
// (el packing usa la base LIV-40 y Siigo la -5 → refFamilyKey los cruza).
//
// El mismo query ya vivía dentro de ImportCostingSection, que traía sale_price
// y nunca lo leía. Acá se expone para que el tablero calcule margen.
// Devuelve ARRAY plano: el cache se persiste como JSON y un Map no sobrevive.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { refFamilyKey } from '@/lib/refFamily';

export interface PrecioFamilia {
  familia: string;
  cost: number;
  sale: number;
}

export function useListaPrecios() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['lista-precios-familia', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PrecioFamilia[]> => {
      // Sin filtro user_id: la RLS resuelve por current_data_owner() (si se
      // filtra, un colaborador no ve nada — bug ya sufrido en este módulo).
      const { data, error } = await supabase
        .from('inventory_products')
        .select('reference, cost_per_unit, sale_price');
      if (error) throw error;
      const m = new Map<string, PrecioFamilia>();
      for (const r of (data ?? []) as Array<{ reference: string; cost_per_unit: number | null; sale_price: number | null }>) {
        if (!r.reference) continue;
        m.set(refFamilyKey(r.reference), {
          familia: refFamilyKey(r.reference),
          cost: Number(r.cost_per_unit) || 0,
          sale: Number(r.sale_price) || 0,
        });
      }
      return Array.from(m.values());
    },
  });
}

/** Índice por familia — se arma AL USAR, nunca viaja en la query. */
export function listaPreciosIndex(rows: PrecioFamilia[] | undefined): Map<string, PrecioFamilia> {
  return new Map((rows ?? []).map((r) => [r.familia, r]));
}
