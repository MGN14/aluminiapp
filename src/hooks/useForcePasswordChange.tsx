import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface ForcePasswordChangeState {
  /** Whether we are still resolving the flag. Consumers should wait before routing. */
  loading: boolean;
  /** True when profiles.force_password_change is true for the current user. */
  required: boolean;
  /** Force a refetch — use after the user completes the flow. */
  refresh: () => Promise<void>;
}

/**
 * Reads `public.profiles.force_password_change` for the current user.
 * Returns a flag the router uses to gate protected routes and redirect
 * to /change-password.
 */
export function useForcePasswordChange(): ForcePasswordChangeState {
  const { user, loading: authLoading } = useAuth();
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchFlag = async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('force_password_change')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      // Fail-open: don't block users if the query itself fails.
      console.error('[force_password_change] fetch error', error);
      setRequired(false);
    } else {
      setRequired(!!data?.force_password_change);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRequired(false);
      setLoading(false);
      return;
    }
    void fetchFlag(user.id);
  }, [authLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    loading,
    required,
    refresh: async () => {
      if (user?.id) await fetchFlag(user.id);
    },
  };
}
