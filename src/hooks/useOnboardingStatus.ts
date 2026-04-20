import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

function getLocalCompleted(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(`onboarding_completed:${userId}`) === 'true';
  } catch {
    return false;
  }
}

export function useOnboardingStatus() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      // localStorage wins — lets users proceed even if the DB schema isn't migrated yet
      if (getLocalCompleted(user.id)) return { onboarding_completed: true };
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
    try {
      localStorage.setItem(`onboarding_completed:${user.id}`, 'true');
    } catch { /* ignore */ }
    try {
      await (supabase as any)
        .from('profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', user.id);
    } catch { /* DB column may not exist, localStorage is enough */ }
    qc.invalidateQueries({ queryKey: ['onboarding-status'] });
  };

  return {
    isLoading,
    completed: data?.onboarding_completed ?? false,
    markComplete,
  };
}
