import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface IncomeReceiptRow {
  id: string;
  user_id: string;
  numero_consecutivo: string | null;
  fecha: string; // YYYY-MM-DD
  payer_responsible_id: string | null;
  payer_name: string;
  payer_document: string | null;
  payer_document_type: 'CC' | 'CE' | 'NIT' | 'PA' | null;
  payer_address: string | null;
  payer_city: string | null;
  payer_phone: string | null;
  amount: number;
  concept: string;
  payment_method: string | null;
  reference_doc: string | null;
  notes: string | null;
  use_letterhead: boolean;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export type IncomeReceiptPatch = Partial<Omit<IncomeReceiptRow, 'id' | 'user_id' | 'numero_consecutivo' | 'created_at' | 'updated_at'>> & {
  fecha: string;
  payer_name: string;
  amount: number;
  concept: string;
};

export function useIncomeReceipts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery<IncomeReceiptRow[]>({
    queryKey: ['income_receipts', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('income_receipts' as never)
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data as unknown) as IncomeReceiptRow[]) ?? [];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['income_receipts', user?.id] });

  const create = useMutation({
    mutationFn: async (input: IncomeReceiptPatch) => {
      if (!user) throw new Error('No auth');
      const { data, error } = await supabase
        .from('income_receipts' as never)
        .insert({ user_id: user.id, ...input } as never)
        .select('*')
        .single();
      if (error) throw error;
      return (data as unknown) as IncomeReceiptRow;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Comprobante creado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al crear', description: err.message, variant: 'destructive' });
    },
  });

  const update = useMutation({
    mutationFn: async (input: { id: string } & IncomeReceiptPatch) => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from('income_receipts' as never)
        .update(patch as never)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return (data as unknown) as IncomeReceiptRow;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Comprobante actualizado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al actualizar', description: err.message, variant: 'destructive' });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('income_receipts' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Comprobante eliminado' });
    },
  });

  return {
    receipts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create,
    update,
    remove,
  };
}
