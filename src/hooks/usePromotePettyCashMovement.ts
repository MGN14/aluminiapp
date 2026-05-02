import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface PromoteResult {
  cash_movement_id: string;
  petty_cash_movement_id: string;
}

export function usePromotePettyCashMovement() {
  const qc = useQueryClient();
  return useMutation<PromoteResult, Error, string>({
    mutationFn: async (movementId) => {
      const { data, error } = await supabase.rpc(
        'promote_petty_cash_to_cash_movement' as never,
        { p_movement_id: movementId } as never,
      );
      if (error) throw error;
      return data as unknown as PromoteResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      qc.invalidateQueries({ queryKey: ['cash_movements'] });
      qc.invalidateQueries({ queryKey: ['operative-receivables'] });
    },
  });
}
