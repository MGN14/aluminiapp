import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export function useOnboardingStatus() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle();
      // Fail open: if column doesn't exist yet, don't block users
      if (error) return { onboarding_completed: true };
      return data as { onboarding_completed: boolean } | null;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const markComplete = async () => {
    if (!user?.id) return;
    await (supabase as any)
      .from('profiles')
      .update({ onboarding_completed: true })
      .eq('user_id', user.id);
    qc.invalidateQueries({ queryKey: ['onboarding-status'] });
  };

  return {
    isLoading,
    completed: data?.onboarding_completed ?? false,
    markComplete,
  };
}
