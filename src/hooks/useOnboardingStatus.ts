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

function setLocalCompleted(userId: string) {
  try {
    localStorage.setItem(`onboarding_completed:${userId}`, 'true');
  } catch {
    /* private mode */
  }
}

export function useOnboardingStatus() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Fast-path: if localStorage says done, we consider the user onboarded
  // IMMEDIATELY. The background query below still runs to heal the DB if
  // needed, but ProtectedRoute won't loop waiting for it.
  const localCompleted = getLocalCompleted(user?.id);

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle();

      // Fail open: if column doesn't exist yet, don't block users.
      if (error) return { onboarding_completed: true };

      const dbCompleted = data?.onboarding_completed === true;

      // Self-heal: if localStorage says done but DB disagrees, sync DB so
      // other browsers/devices stop redirecting to /onboarding.
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

      // Reverse heal: if DB says done but localStorage is empty (fresh
      // incognito / new device), cache it locally so subsequent renders
      // hit the fast-path.
      if (dbCompleted && !localCompleted) {
        setLocalCompleted(user.id);
      }

      return data as { onboarding_completed: boolean } | null;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const markComplete = async () => {
    if (!user?.id) throw new Error('No authenticated user');
    setLocalCompleted(user.id);

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
      // Don't throw — localStorage is set so the user can proceed; the
      // background self-heal will retry on next render.
    }

    // Prime the cache so ProtectedRoute's next render sees completed=true
    // synchronously (no flash of /onboarding redirect).
    qc.setQueryData(['onboarding-status', user.id], { onboarding_completed: true });
    qc.invalidateQueries({ queryKey: ['onboarding-status'] });
  };

  // Trust localStorage instantly; fall back to DB result.
  const completed = localCompleted || data?.onboarding_completed === true;

  return {
    isLoading: isLoading && !localCompleted,
    completed,
    markComplete,
  };
}
