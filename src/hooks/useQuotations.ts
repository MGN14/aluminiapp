import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Quotation, QuotationStatus } from '@/types/quotation';

export interface QuotationListRow extends Quotation {
  responsible_name: string | null;
}

export function useQuotations(filters?: {
  status?: QuotationStatus | 'all';
  search?: string;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['quotations', user?.id, filters?.status ?? 'all', filters?.search ?? ''],
    queryFn: async (): Promise<QuotationListRow[]> => {
      let q = supabase
        .from('quotations' as never)
        .select(
          `
          *,
          responsibles:responsible_id (name)
        `,
        )
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false }) as any;

      if (filters?.status && filters.status !== 'all') {
        q = q.eq('status', filters.status);
      }
      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as Array<
        Quotation & { responsibles: { name: string } | null }
      >;
      let mapped: QuotationListRow[] = rows.map((r) => ({
        ...r,
        responsible_name: r.responsibles?.name ?? null,
      }));

      if (filters?.search?.trim()) {
        const s = filters.search.trim().toLowerCase();
        mapped = mapped.filter(
          (r) =>
            r.quote_number.toLowerCase().includes(s) ||
            (r.responsible_name ?? '').toLowerCase().includes(s),
        );
      }
      return mapped;
    },
    enabled: !!user?.id,
  });
}
