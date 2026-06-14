import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface YearClosingLine {
  id: string;
  closing_id: string;
  rubro: string;
  responsible_id: string | null;
  responsible_name: string | null;
  suggested_amount: number;
  real_amount: number;
  difference: number;
}

export interface YearClosing {
  id: string;
  user_id: string;
  fiscal_year: number;
  period_start: string;
  period_end: string;
  total_sugerido: number;
  total_real: number;
  total_diferencia: number;
  rolled_forward: boolean;
  notes: string | null;
  closed_at: string;
  lines: YearClosingLine[];
}

export function useYearClosings() {
  const { user } = useAuth();
  return useQuery<YearClosing[]>({
    queryKey: ['year-closings', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: closings, error }, { data: lines, error: lErr }] = await Promise.all([
        supabase.from('year_closings' as never).select('*').order('fiscal_year', { ascending: false }),
        supabase.from('year_closing_lines' as never).select('*'),
      ]);
      if (error) throw error;
      if (lErr) throw lErr;
      const linesByClosing = new Map<string, YearClosingLine[]>();
      for (const l of ((lines ?? []) as unknown as YearClosingLine[])) {
        const arr = linesByClosing.get(l.closing_id) ?? [];
        arr.push({ ...l, suggested_amount: Number(l.suggested_amount) || 0, real_amount: Number(l.real_amount) || 0, difference: Number(l.difference) || 0 });
        linesByClosing.set(l.closing_id, arr);
      }
      return ((closings ?? []) as unknown as YearClosing[]).map((c) => ({
        ...c,
        fiscal_year: Number(c.fiscal_year) || 0,
        total_sugerido: Number(c.total_sugerido) || 0,
        total_real: Number(c.total_real) || 0,
        total_diferencia: Number(c.total_diferencia) || 0,
        lines: linesByClosing.get(c.id) ?? [],
      }));
    },
  });
}

export interface CloseFiscalYearLineInput {
  rubro: string;
  responsible_id: string | null;
  responsible_name: string | null;
  suggested_amount: number;
  real_amount: number;
}

export interface CloseFiscalYearInput {
  fiscal_year: number;
  lines: CloseFiscalYearLineInput[];
  total_sugerido: number;
  total_real: number;
  notes?: string;
}

export function useCloseFiscalYear() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CloseFiscalYearInput) => {
      const { data, error } = await (supabase as any).rpc('close_fiscal_year', {
        p_fiscal_year: input.fiscal_year,
        p_lines: input.lines,
        p_total_sugerido: input.total_sugerido,
        p_total_real: input.total_real,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['year-closings', user?.id] }),
  });
}

export function useReopenFiscalYear() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (closingId: string) => {
      const { data, error } = await (supabase as any).rpc('reopen_fiscal_year', { p_closing_id: closingId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['year-closings', user?.id] }),
  });
}
