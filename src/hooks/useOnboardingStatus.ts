import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
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

      const localCompleted = getLocalCompleted(user.id);

      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle();

      // Fail open: if column doesn't exist yet, don't block users.
      if (error) return { onboarding_completed: true };

      const dbCompleted = data?.onboarding_completed === true;

      // Self-heal: localStorage marked completed but DB never registered it
      // (happens when the original markComplete failed silently in another
      // browser/device). Sync DB so other browsers stop looping to /onboarding.
      if (localCompleted && !dbCompleted) {
        const { error: healError } = await (supabase as any)
          .from('profiles')
          .upsert(
            { user_id: user.id, onboarding_completed: true },
            { onConflict: 'user_id' },
          );
        if (healError) {
          Sentry.captureException(healError, {
            tags: { feature: 'onboarding', step: 'self_heal' },
          });
        }
        return { onboarding_completed: true };
      }

      return data as { onboarding_completed: boolean } | null;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const markComplete = async () => {
    if (!user?.id) return;
    try {
      localStorage.setItem(`onboarding_completed:${user.id}`, 'true');
    } catch {
      /* localStorage may be unavailable in private mode — DB is the source of truth */
    }
    const { error } = await (supabase as any)
      .from('profiles')
      .upsert(
        { user_id: user.id, onboarding_completed: true },
        { onConflict: 'user_id' },
      );
    if (error) {
      Sentry.captureException(error, {
        tags: { feature: 'onboarding', step: 'mark_complete' },
      });
    }
    qc.invalidateQueries({ queryKey: ['onboarding-status'] });
  };

  return {
    isLoading,
    completed: data?.onboarding_completed ?? false,
    markComplete,
  };
}
